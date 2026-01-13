#!/usr/bin/env python3
"""
WebSocket Server for UCAgent PDB Interaction using PTY
This server creates a WebSocket endpoint that allows direct interaction with UCAgent's PDB mode
using a pseudo-terminal (PTY) to properly handle the interactive session.
"""

import asyncio
import json
import logging
import os
import pty
import signal
import select
import subprocess
import threading
import time
from queue import Queue, Empty
from typing import Dict

import websockets
from websockets.exceptions import ConnectionClosed

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('output/ws.log'),
        logging.StreamHandler()  # Also log to console
    ]
)
logger = logging.getLogger(__name__)

# Global variables
clients = set()
clients_lock = threading.Lock()  # Thread lock for client set operations

# Queue for passing messages from PDB reader thread to async event loop
message_queue = Queue(maxsize=1000)  # Added maxsize to prevent memory issues

# Global variables for PDB interaction
pdb_input_queue = Queue()
master_fd = None  # Master file descriptor for the PTY
agent_process = None  # Reference to the UCAgent subprocess

def setup_pty(target="Adder"):
    """Create a pseudo-terminal and start UCAgent process."""
    global master_fd, agent_process

    # Create a pseudo-terminal pair
    master_fd, slave_fd = pty.openpty()
    logger.info(f"PTY created: master_fd={master_fd}, slave_fd={slave_fd}")

    # Start UCAgent process using Makefile target with the slave end of the PTY as stdin/stdout/stderr
    try:
        command = f"sed '/^mcp_%: init_%/,/^$/ s/--tui //' Makefile > Makefile.tmp && stdbuf -oL -eL make -f Makefile.tmp mcp_{target}"

        # Try to determine the correct working directory for UCAgent
        import pathlib
        current_dir = pathlib.Path.cwd()

        # Look for UCAgent directory in common locations
        ucagent_paths = [
            current_dir.parent / "UCAgent",  # ../UCAgent (original)
            current_dir / "UCAgent",         # ./UCAgent
            current_dir / ".." / ".." / "UCAgent",  # ../../UCAgent
            pathlib.Path("../UCAgent"),
            pathlib.Path("./UCAgent"),
            pathlib.Path("../../UCAgent")
        ]

        ucagent_cwd = None
        for path in ucagent_paths:
            if path.exists() and (path / "Makefile").exists():
                ucagent_cwd = str(path)
                logger.info(f"Found UCAgent directory at: {ucagent_cwd}")
                break

        if ucagent_cwd is None:
            logger.error("Could not find UCAgent directory with Makefile. Looking for it in common locations.")
            # Fallback: try to run in current directory if no UCAgent dir is found
            ucagent_cwd = str(current_dir)
            logger.info(f"Falling back to current directory: {ucagent_cwd}")

        agent_process = subprocess.Popen(
            command,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            universal_newlines=True,
            cwd=ucagent_cwd,
            shell=True,
            preexec_fn=os.setsid  # Create new process group for easier management
        )
        os.close(slave_fd)  # Close the slave end in the parent process

        logger.info(f"UCAgent process started with PTY, PID: {agent_process.pid}")

        # Send welcome message
        try:
            message_queue.put_nowait({  # Changed from put to put_nowait to prevent blocking
                "type": "output",
                "data": "Connected to UCAgent PDB mode via PTY.\n(UnityChip) "
            })
        except:
            logger.warning("Message queue is full, dropping welcome message")
    except Exception as e:
        logger.error(f"Failed to start UCAgent process: {e}")
        logger.error(f"Current working directory: {os.getcwd()}")
        import pathlib
        logger.error(f"Contents of current directory: {list(pathlib.Path('.').iterdir())}")
        if master_fd:
            os.close(master_fd)
            master_fd = None


def cleanup_pty():
    """Clean up PTY resources and terminate the agent process."""
    global master_fd, agent_process

    logger.info("Cleaning up PTY resources...")

    if agent_process:
        logger.info(f"Terminating UCAgent process with PID: {agent_process.pid}")
        try:
            # Terminate the process gracefully using process group
            os.killpg(os.getpgid(agent_process.pid), signal.SIGTERM)
            try:
                # Wait for the process to terminate with a timeout
                agent_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't terminate gracefully
                logger.warning(f"Process {agent_process.pid} didn't terminate gracefully, killing it")
                os.killpg(os.getpgid(agent_process.pid), signal.SIGKILL)
                agent_process.wait()  # Wait for the kill to complete
        except Exception as e:
            logger.error(f"Error terminating agent process: {e}")
        agent_process = None

    if master_fd:
        try:
            os.close(master_fd)
        except OSError:
            pass  # Ignore errors when closing the file descriptor
        master_fd = None
        logger.info("PTY master file descriptor closed")


def send_command_to_pdb(command: str):
    """Send a command to the UCAgent process via PTY."""
    global master_fd

    if master_fd is None:
        logger.error("PTY not available. UCAgent process may not be running.")
        return "Error: Cannot connect to UCAgent. Process not running.\n"

    try:
        # Write command to the PTY master
        os.write(master_fd, (command + '\n').encode('utf-8'))
        logger.info(f"Command sent to UCAgent: {command}")
        return f"Command '{command}' sent to UCAgent.\n"
    except Exception as e:
        logger.error(f"Error sending command to UCAgent: {e}")
        return f"Error sending command: {str(e)}\n"


def pty_output_reader():
    """Thread function to read output from the PTY and put messages in queue."""
    global master_fd
    buffer = ""

    while True:
        try:
            if master_fd is None:
                time.sleep(0.1)
                continue

            # Use select to check if data is available to read
            ready, _, _ = select.select([master_fd], [], [], 0.1)

            if ready:
                # Read available data from the PTY
                try:
                    data = os.read(master_fd, 1024)
                    if data:
                        output_str = data.decode('utf-8', errors='ignore')

                        # Log the PTY output to the ws.log file
                        logger.info(f"PTY output: {repr(output_str)}")

                        # Put message in queue for async handler
                        try:
                            message_queue.put({
                                "type": "output",
                                "data": output_str
                            }, block=False)  # Non-blocking put
                        except:
                            logger.warning("Message queue is full, dropping message")
                    else:
                        # EOF reached, process may have terminated
                        logger.error("PTY read returned empty, UCAgent process may have terminated. Shutting down server.")
                        # Stop the thread since the process has terminated
                        try:
                            os.close(master_fd)
                        except:
                            pass
                        master_fd = None
                        break
                except OSError as e:
                    logger.error(f"Error reading from PTY: {e}")
                    # Stop the thread since there's an error with the PTY
                    try:
                        os.close(master_fd)
                    except:
                        pass
                    master_fd = None
                    break
        except Exception as e:
            logger.error(f"Unexpected error in PTY output reader: {e}")
            time.sleep(0.5)


def pty_input_handler():
    """Thread function to handle input to PDB."""
    logger.info("PTY input handler started")

    while True:
        try:
            # Check for input from WebSocket clients
            try:
                command = pdb_input_queue.get(timeout=0.1)

                # Send command to UCAgent via PTY
                response = send_command_to_pdb(command)

                # Send response to all clients (optional - usually the actual output comes from PTY)
                try:
                    message_queue.put({
                        "type": "output",
                        "data": response
                    }, block=False)
                except:
                    logger.warning("Message queue is full, dropping output")

            except Empty:
                # No input available, continue loop
                continue

        except Exception as e:
            logger.error(f"Error in PTY input handler: {e}")
            time.sleep(0.1)


async def send_command_to_pdb_async(command: str):
    """Queue a command to be sent to PDB."""
    try:
        pdb_input_queue.put_nowait(command)  # Changed to put_nowait to prevent blocking
        logger.info(f"Command queued for UCAgent: {command}")
        return f"Command '{command}' queued for UCAgent.\n"
    except Exception as e:
        logger.error(f"Unexpected error queuing command to UCAgent: {e}")
        return f"Unexpected error queuing command: {str(e)}\n"


async def broadcast_pty_output():
    """Async function to handle messages from the queue."""
    while True:
        try:
            # Non-blocking get from queue
            try:
                message_data = message_queue.get_nowait()
                await broadcast_message_to_clients(message_data)
            except Empty:
                await asyncio.sleep(0.05)  # Brief sleep when queue is empty
                continue
        except Exception as e:
            logger.error(f"Error handling message queue: {e}")
            await asyncio.sleep(0.1)


async def broadcast_message_to_clients(message_data):
    """Broadcast a message to all connected WebSocket clients."""
    # Create a copy of the clients set to avoid race conditions
    with clients_lock:
        clients_copy = list(clients)  # Create a snapshot of the clients list

    disconnected_clients = []

    for client in clients_copy:
        try:
            await client.send(json.dumps(message_data))
        except ConnectionClosed:
            disconnected_clients.append(client)
        except Exception as e:
            logger.warning(f"Error sending to client: {e}")
            disconnected_clients.append(client)

    # Remove disconnected clients
    with clients_lock:
        for client in disconnected_clients:
            clients.discard(client)


async def handle_message_queue():
    """Async function to handle messages from the queue."""
    while True:
        try:
            # Try to get a message from the queue with a timeout
            try:
                message_data = message_queue.get(timeout=0.1)  # 100ms timeout
                await broadcast_message_to_clients(message_data)
            except Empty:
                # No messages in queue, continue loop
                continue
        except Exception as e:
            logger.error(f"Error handling message queue: {e}")
            await asyncio.sleep(0.1)


async def pty_handler(websocket):
    """Handle WebSocket connections for PTY communication."""
    global clients

    if hasattr(websocket, 'remote_address') and websocket.remote_address:
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    else:
        client_addr = "unknown"

    logger.info(f"✅ WebSocket connection established with {client_addr}")

    with clients_lock:
        clients.add(websocket)
        logger.info(f"Active WebSocket connections: {len(clients)}")

    try:
        # Send welcome message if not already sent by the input handler
        welcome_msg = {
            "type": "output",
            "data": "Connected to UCAgent PTY WebSocket. Type commands to interact with UCAgent.\n(UnityChip) "
        }
        await websocket.send(json.dumps(welcome_msg))

        # Main loop to handle messages
        async for message in websocket:
            try:
                # Parse the incoming message
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "input":
                    command = data.get("data", "")

                    # Echo the command back to the sender
                    echo_msg = {
                        "type": "echo",
                        "data": f"> {command}\n"
                    }
                    await websocket.send(json.dumps(echo_msg))

                    # Send the command to UCAgent
                    response = await send_command_to_pdb_async(command)

                    # Send the response back to the client (optional - actual output comes from PTY)
                    output_msg = {
                        "type": "output",
                        "data": response
                    }
                    await websocket.send(json.dumps(output_msg))

                elif msg_type == "ping":
                    # Respond to ping
                    pong_msg = {"type": "pong", "data": "alive"}
                    await websocket.send(json.dumps(pong_msg))

            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received from client")
                error_msg = {
                    "type": "error",
                    "data": f"Invalid JSON: {message[:100]}..."
                }
                try:
                    await websocket.send(json.dumps(error_msg))
                except Exception as e:
                    logger.warning(f"Error sending error message to client: {e}")
            except ConnectionClosed:
                logger.info("Client disconnected during message processing")
                break
            except Exception as e:
                logger.error(f"Error processing message from client: {e}")
                error_msg = {
                    "type": "error",
                    "data": f"Error processing command: {str(e)}"
                }
                try:
                    await websocket.send(json.dumps(error_msg))
                except Exception as e:
                    logger.warning(f"Error sending error message to client: {e}")
                    break  # Exit the loop on error to ensure proper cleanup

    except ConnectionClosed as e:
        logger.info(f"PTY client disconnected: code={e.code}, reason={e.reason}")
    except Exception as e:
        logger.error(f"Error in PTY handler: {e}")
    finally:
        # Explicitly close the WebSocket connection to prevent CLOSE_WAIT state
        try:
            if not websocket.closed:
                await websocket.close(code=1000, reason="Client disconnected")
        except Exception as e:
            logger.warning(f"Error closing WebSocket: {e}")

        with clients_lock:
            clients.discard(websocket)
        logger.info(f"Client disconnected. Remaining clients: {len(clients)}")


async def websocket_handler(websocket):
    """Handle WebSocket connections for PTY communication."""
    if hasattr(websocket, 'remote_address') and websocket.remote_address:
        client_ip = websocket.remote_address[0]
        client_port = websocket.remote_address[1]
    else:
        client_ip = "unknown"
        client_port = 0

    logger.info(f"Connection attempt from {client_ip}:{client_port}")

    logger.info(f"Upgrading to WebSocket for {client_ip}:{client_port}")
    try:
        await pty_handler(websocket)
    except Exception as e:
        logger.error(f"Error in pty_handler: {e}")
        try:
            await websocket.close(code=1011, reason=f"Internal server error: {str(e)}")
        except:
            pass


async def main(target="Adder"):
    """Main function to start the WebSocket server."""
    logger.info("Starting UCAgent PTY WebSocket Server on port 8080...")

    # Set up signal handling for graceful shutdown
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        cleanup_pty()
        # Get event loop and stop it
        loop = asyncio.get_event_loop()
        for task in asyncio.all_tasks(loop):
            task.cancel()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        # Setup the PTY and start UCAgent
        setup_pty(target)

        # Start the PTY output reader thread
        output_reader_thread = threading.Thread(target=pty_output_reader, daemon=True)
        output_reader_thread.start()
        logger.info("PTY output reader thread started")

        # Start the PTY input handler thread
        input_handler_thread = threading.Thread(target=pty_input_handler, daemon=True)
        input_handler_thread.start()
        logger.info("PTY input handler thread started")

        # Create server task
        server = await websockets.serve(
            websocket_handler,
            "127.0.0.1",
            8080,
            ping_interval=20,
            ping_timeout=40,  # Increased timeout to prevent premature disconnections
            close_timeout=10,
            origins=None,  # Disable origin checking completely
            max_size=2**20,
            compression=None,
            server_header="UCAgent-PTY-WebSocket/1.0"
        )

        # Start output broadcast task
        broadcast_task = asyncio.create_task(broadcast_pty_output())

        logger.info("PTY WebSocket server listening on ws://127.0.0.1:8080")
        logger.info("Server is ready to accept connections")

        # Run both tasks concurrently
        await server.wait_closed()
        await broadcast_task

    except Exception as e:
        logger.error(f"Server startup failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        cleanup_pty()
        logger.info("Server shutdown")


if __name__ == "__main__":
    import sys
    # Set event loop policy (needed on some systems)
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutting down PTY server...")
        cleanup_pty()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        cleanup_pty()
        raise