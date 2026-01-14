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
    """
    Create a pseudo-terminal and start UCAgent process.

    This function sets up a pseudo-terminal (PTY) and launches the UCAgent process
    with its standard I/O connected to the PTY. It also handles finding the correct
    UCAgent directory and preparing the command to run.

    Args:
        target (str): The Makefile target to build and run. Defaults to "Adder".

    Global Variables Modified:
        master_fd: The file descriptor for the PTY master end
        agent_process: The subprocess object representing the UCAgent process
    """
    # Reference global variables to access and modify them
    global master_fd, agent_process

    # Create a pseudo-terminal pair
    # master_fd: Parent process uses this to communicate with the child process
    # slave_fd: Child process uses this as its stdin/stdout/stderr
    master_fd, slave_fd = pty.openpty()
    logger.info(f"PTY created: master_fd={master_fd}, slave_fd={slave_fd}")

    # Start UCAgent process using Makefile target with the slave end of the PTY as stdin/stdout/stderr
    try:
        # Prepare the command to run:
        # 1. Modify the Makefile to remove the --tui option (which requires a terminal)
        # 2. Use stdbuf to disable output buffering for real-time output
        # 3. Run the specified target from the modified Makefile
        # command = f"sed '/^mcp_%: init_%/,/^$/ s/--tui //' Makefile > Makefile.tmp && stdbuf -oL -eL make -f Makefile.tmp mcp_{target}"

        # Try to determine the correct working directory for UCAgent
        import pathlib
        current_dir = pathlib.Path.cwd()

        # Look for UCAgent directory in common locations
        # This makes the code more flexible by searching in multiple possible locations
        ucagent_paths = [
            current_dir.parent / "UCAgent",  # ../UCAgent (original)
            current_dir / "UCAgent",         # ./UCAgent
            current_dir / ".." / ".." / "UCAgent",  # ../../UCAgent
            pathlib.Path("../UCAgent"),
            pathlib.Path("./UCAgent"),
            pathlib.Path("../../UCAgent")
        ]

        ucagent_cwd = None
        # Check each possible location for the UCAgent directory
        for path in ucagent_paths:
            # Verify that the path exists and contains a Makefile
            if path.exists() and (path / "Makefile").exists():
                ucagent_cwd = str(path)
                logger.info(f"Found UCAgent directory at: {ucagent_cwd}")
                break

        # If UCAgent directory not found in any of the expected locations
        if ucagent_cwd is None:
            logger.error("Could not find UCAgent directory with Makefile. Looking for it in common locations.")
            # Fallback: try to run in current directory if no UCAgent dir is found
            ucagent_cwd = str(current_dir)
            logger.info(f"Falling back to current directory: {ucagent_cwd}")

        # Create the temporary Makefile first
        temp_makefile_path = os.path.join(ucagent_cwd, "Makefile.tmp")
        sed_command = f"sed '/^mcp_%: init_%/,/^$/ s/--tui //' Makefile > {temp_makefile_path}"
        subprocess.run(sed_command, shell=True, cwd=ucagent_cwd)

        # Start the UCAgent process with the PTY as its I/O
        agent_process = subprocess.Popen(
            f"stdbuf -oL -eL make -f Makefile.tmp mcp_{target}",  # Just run the make command with the temp file
            stdin=slave_fd,             # Connect stdin to the PTY slave
            stdout=slave_fd,            # Connect stdout to the PTY slave
            stderr=slave_fd,            # Connect stderr to the PTY slave
            universal_newlines=True,    # Open files in text mode
            cwd=ucagent_cwd,            # Set working directory
            shell=True,                 # Execute command through the shell
            preexec_fn=os.setsid        # Create new process group for easier management
        )
        # Close the slave end in the parent process
        # The child process has its own copy, so we don't need it here
        os.close(slave_fd)

        logger.info(f"UCAgent process started with PTY, PID: {agent_process.pid}")

        # Write PID to file
        try:
            pid_dir = os.path.join(os.path.dirname(__file__), "output")
            os.makedirs(pid_dir, exist_ok=True)  # Create directory if it doesn't exist
            pid_file = os.path.join(pid_dir, ".agent.pid")
            with open(pid_file, 'w') as f:
                f.write(str(agent_process.pid))
            logger.info(f"PID {agent_process.pid} written to {pid_file}")
        except Exception as e:
            logger.error(f"Failed to write PID to file: {e}")

        # Send welcome message to clients
        try:
            # Put a welcome message in the queue for broadcasting to clients
            message_queue.put_nowait({  # Changed from put to put_nowait to prevent blocking
                "type": "output",
                "data": "Connected to UCAgent PDB mode via PTY.\n"
            })

            # Send an initial command to get the agent started (e.g., continue execution)
            # This ensures the agent is in a state where it can accept commands
            time.sleep(2)  # Wait a bit for the agent to fully initialize
            os.write(master_fd, b"continue\n")  # Send continue command to PDB to start processing
        except Exception as e:
            # If the queue is full or there's an error, log a warning but don't block
            logger.warning(f"Error sending welcome message or initial command: {e}")
    except Exception as e:
        # Handle any errors that occur during PTY setup or process startup
        logger.error(f"Failed to start UCAgent process: {e}")
        logger.error(f"Current working directory: {os.getcwd()}")
        import pathlib
        logger.error(f"Contents of current directory: {list(pathlib.Path('.').iterdir())}")
        # Clean up the PTY master file descriptor if it was created
        if master_fd:
            os.close(master_fd)
            master_fd = None


def cleanup_pty():
    """
    Clean up PTY resources and terminate the agent process.

    This function ensures proper cleanup of resources associated with the
    pseudo-terminal (PTY) and the UCAgent process. It attempts to gracefully
    terminate the process first, and if that fails, forcefully terminates it.
    It also closes the PTY master file descriptor and resets the global
    variables to indicate that these resources are no longer available.
    """
    # Reference the global variables to access and modify them
    global master_fd, agent_process

    # Log the start of the cleanup process
    logger.info("Cleaning up PTY resources...")

    # Handle the agent process termination
    if agent_process:
        # Log the process ID being terminated
        logger.info(f"Terminating UCAgent process with PID: {agent_process.pid}")
        try:
            # Terminate the process gracefully using process group
            # This ensures all child processes are also terminated
            os.killpg(os.getpgid(agent_process.pid), signal.SIGTERM)
            try:
                # Wait for the process to terminate with a timeout
                # This prevents the function from blocking indefinitely
                agent_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't terminate gracefully
                logger.warning(f"Process {agent_process.pid} didn't terminate gracefully, killing it")
                # Send SIGKILL to forcefully terminate the process
                os.killpg(os.getpgid(agent_process.pid), signal.SIGKILL)
                # Wait for the kill to complete
                agent_process.wait()
        except Exception as e:
            # Log any errors that occur during process termination
            logger.error(f"Error terminating agent process: {e}")
        # Set the agent_process to None to indicate it's no longer running
        agent_process = None

    # Handle the PTY file descriptor cleanup
    if master_fd:
        try:
            # Close the PTY master file descriptor
            os.close(master_fd)
        except OSError:
            # Ignore errors when closing the file descriptor
            # This might happen if the file descriptor is already closed
            pass
        # Set master_fd to None to indicate it's no longer available
        master_fd = None
        # Log the successful closure of the file descriptor
        logger.info("PTY master file descriptor closed")


def send_command_to_pdb(command: str):
    """
    Send a command to the UCAgent process via PTY (pseudo-terminal).

    This function writes the provided command to the PTY master file descriptor,
    which is connected to the UCAgent process. The command is automatically
    terminated with a newline character before being sent.

    Args:
        command (str): The command string to be sent to the UCAgent process

    Returns:
        str: A message indicating whether the command was successfully sent
             or an error message if sending failed
    """
    # Reference the global master_fd variable to access the PTY file descriptor
    global master_fd

    # Check if the PTY file descriptor is available
    if master_fd is None:
        # Log an error if PTY is not available
        logger.error("PTY not available. UCAgent process may not be running.")
        # Return an error message to the caller
        return "Error: Cannot connect to UCAgent. Process not running.\n"

    try:
        # Write command to the PTY master file descriptor
        # The command is concatenated with a newline character before encoding
        # This ensures the command is properly terminated for the receiving process
        os.write(master_fd, (command + '\n').encode('utf-8'))

        # Log the successful sending of the command
        logger.info(f"Command sent to UCAgent: {command}")

        # Return a success message to the caller
        return f"Command '{command}' sent to UCAgent.\n"

    except Exception as e:
        # Handle any errors that occur during the command sending process
        logger.error(f"Error sending command to UCAgent: {e}")

        # Return an error message to the caller with details of the exception
        return f"Error sending command: {str(e)}\n"



def pty_output_reader():
    """
    Thread function to read output from the PTY and put messages in queue.

    This function runs in a separate thread and continuously monitors the PTY
    (pseudo-terminal) for output from the UCAgent process. It reads the output,
    processes it, and puts it in a message queue for broadcasting to WebSocket clients.

    The function handles various error conditions, including PTY disconnection,
    and ensures proper cleanup of resources.
    """
    # Reference the global master_fd variable to track the PTY file descriptor
    global master_fd

    # Initialize a buffer to accumulate partial output (though not used in current implementation)
    buffer = ""

    # Main loop to continuously read from the PTY
    while True:
        try:
            # Check if the PTY file descriptor is available
            if master_fd is None:
                # If PTY is not available, sleep briefly and continue to the next iteration
                time.sleep(0.1)
                continue

            # Use select to check if data is available to read without blocking
            # This allows the thread to periodically check for other conditions
            ready, _, _ = select.select([master_fd], [], [], 0.1)

            if ready:
                # Read available data from the PTY
                try:
                    # Read up to 1024 bytes from the PTY master file descriptor
                    data = os.read(master_fd, 1024)

                    if data:
                        # Decode the binary data to a UTF-8 string, ignoring decoding errors
                        output_str = data.decode('utf-8', errors='ignore')

                        # Log the PTY output to the ws.log file for debugging purposes
                        # Using repr() to show special characters and control sequences
                        logger.info(f"PTY output: {repr(output_str)}")

                        # Put message in queue for async handler to broadcast to clients
                        try:
                            # Create a message dictionary with type and data fields
                            message_queue.put({
                                "type": "output",
                                "data": output_str
                            }, block=False)  # Non-blocking put to avoid blocking the thread
                        except:
                            # If the message queue is full, log a warning and drop the message
                            # This prevents the thread from blocking when the queue is full
                            logger.warning("Message queue is full, dropping message")
                    else:
                        # EOF reached, process may have terminated
                        logger.error("PTY read returned empty, UCAgent process may have terminated. Shutting down server.")
                        # Stop the thread since the process has terminated
                        try:
                            # Close the PTY master file descriptor
                            os.close(master_fd)
                        except:
                            # Ignore errors when closing the file descriptor
                            pass
                        # Set master_fd to None to indicate PTY is no longer available
                        master_fd = None
                        # Exit the loop to terminate the thread
                        break
                except OSError as e:
                    # Handle OS-level errors when reading from the PTY
                    logger.error(f"Error reading from PTY: {e}")
                    # Stop the thread since there's an error with the PTY
                    try:
                        # Close the PTY master file descriptor
                        os.close(master_fd)
                    except:
                        # Ignore errors when closing the file descriptor
                        pass
                    # Set master_fd to None to indicate PTY is no longer available
                    master_fd = None
                    # Exit the loop to terminate the thread
                    break
        except Exception as e:
            # Handle any unexpected errors in the PTY output reader
            logger.error(f"Unexpected error in PTY output reader: {e}")
            # Sleep briefly before retrying to avoid rapid error loops
            time.sleep(0.5)



def pty_input_handler():
    """
    Thread function to handle input to PDB (Python Debugger).

    This function runs in a separate thread and continuously monitors the command queue
    for commands from WebSocket clients. It forwards these commands to the PDB debugger
    via the PTY (pseudo-terminal) and queues the response for broadcasting to clients.

    The function uses a non-blocking approach with timeouts to avoid blocking the thread
    when the queue is empty, and handles various error conditions gracefully.
    """
    # Log the startup of the PTY input handler thread
    logger.info("PTY input handler started")

    # Main loop to continuously process commands from the queue
    while True:
        try:
            # Check for input from WebSocket clients
            try:
                # Get a command from the queue with a timeout to avoid blocking indefinitely
                # If no command is available within 0.1 seconds, an Empty exception is raised
                command = pdb_input_queue.get(timeout=0.1)

                # Send the retrieved command to UCAgent via the PTY
                # This function writes the command to the PTY master file descriptor
                response = send_command_to_pdb(command)

                # Send response to all clients (optional - usually the actual output comes from PTY)
                try:
                    # Put the response in the message queue for broadcasting to clients
                    # block=False prevents blocking if the queue is full
                    message_queue.put({
                        "type": "output",
                        "data": response
                    }, block=False)
                except:
                    # If the message queue is full, log a warning and drop the response
                    # This prevents the thread from blocking when the queue is full
                    logger.warning("Message queue is full, dropping output")

            except Empty:
                # No input available in the queue, continue to the next iteration
                # This allows the thread to periodically check for new commands without blocking
                continue

        except Exception as e:
            # Handle any unexpected errors in the PTY input handler
            logger.error(f"Error in PTY input handler: {e}")

            # Sleep briefly before retrying to avoid rapid error loops
            # This prevents the thread from consuming excessive CPU in case of persistent errors
            time.sleep(0.1)



async def send_command_to_pdb_async(command: str):
    """
    Queue a command to be sent to PDB (Python Debugger).

    This function is used to asynchronously queue commands for the PDB debugger.
    It uses a non-blocking approach to add commands to the input queue, which
    prevents the event loop from being blocked if the queue is full.

    Args:
        command (str): The command string to be sent to PDB

    Returns:
        str: A message indicating whether the command was successfully queued
             or an error message if queuing failed
    """
    try:
        # Add the command to the PDB input queue without blocking
        # put_nowait() immediately raises queue.Full if the queue is full
        pdb_input_queue.put_nowait(command)

        # Log the successful queuing of the command
        logger.info(f"Command queued for UCAgent: {command}")

        # Return a success message to the caller
        return f"Command '{command}' queued for UCAgent.\n"

    except Exception as e:
        # Handle any unexpected errors during the queuing process
        logger.error(f"Unexpected error queuing command to UCAgent: {e}")

        # Return an error message to the caller
        return f"Unexpected error queuing command: {str(e)}\n"



async def broadcast_pty_output():
    """
    Async function to handle messages from the queue and broadcast them to clients.

    This function continuously monitors the message queue for new messages from the PTY
    (pseudo-terminal) and broadcasts them to all connected WebSocket clients. It uses
    a non-blocking approach to check the queue and sleeps briefly when empty to avoid
    excessive CPU usage.
    """
    # Infinite loop to continuously process messages from the queue
    while True:
        try:
            # Try to get a message from the queue without blocking
            try:
                # Non-blocking get from queue - immediately raises Empty if queue is empty
                message_data = message_queue.get_nowait()

                # Broadcast the retrieved message to all connected clients
                await broadcast_message_to_clients(message_data)

            except Empty:
                # Queue is empty - sleep briefly to avoid busy waiting
                # 0.05 seconds provides a good balance between responsiveness and CPU usage
                await asyncio.sleep(0.05)
                continue

        except Exception as e:
            # Log any unexpected errors that occur during message processing
            logger.error(f"Error handling message queue: {e}")

            # Sleep briefly before retrying to avoid rapid error loops
            await asyncio.sleep(0.1)


async def broadcast_message_to_clients(message_data):
    """
    Broadcast a message to all connected WebSocket clients.

    This function sends the provided message to all currently connected clients,
    handling disconnections and errors gracefully. It maintains thread safety
    when accessing the shared clients set.

    Args:
        message_data: The data to be broadcast to all clients. Will be JSON-encoded.
    """
    # Create a copy of the clients set to avoid race conditions
    # Using a lock ensures thread-safe access to the shared clients set
    with clients_lock:
        clients_copy = list(clients)  # Create a snapshot of the clients list

    # Initialize a list to track clients that have disconnected
    disconnected_clients = []

    # Iterate through each client in the snapshot
    for client in clients_copy:
        try:
            # Send the JSON-encoded message to the client
            # json.dumps converts the message data to a JSON string format
            await client.send(json.dumps(message_data))

        # Handle the case where a client has closed the connection
        except ConnectionClosed:
            # Add the client to the list of disconnected clients
            disconnected_clients.append(client)

        # Handle any other exceptions that might occur during message sending
        except Exception as e:
            # Log a warning with the error details
            logger.warning(f"Error sending to client: {e}")
            # Add the client to the list of disconnected clients
            disconnected_clients.append(client)

    # Clean up the clients set by removing disconnected clients
    # Using a lock ensures thread-safe access to the shared clients set
    with clients_lock:
        for client in disconnected_clients:
            # Remove each disconnected client from the clients set
            clients.discard(client)


async def pty_handler(websocket):
    """
    Handle WebSocket connections for PTY communication.

    This function manages individual WebSocket connections for PTY (pseudo-terminal)
    communication. It handles client registration, message processing, command
    execution, and connection cleanup. It serves as the main interface between
    WebSocket clients and the UCAgent process through the PTY.

    Args:
        websocket: The WebSocket connection object for the client

    Global Variables Modified:
        clients: The set of active WebSocket connections
    """
    # Access the global clients set to track connected clients
    global clients

    # Extract client address information if available
    # This helps with logging and debugging client connections
    if hasattr(websocket, 'remote_address') and websocket.remote_address:
        client_addr = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
    else:
        client_addr = "unknown"

    # Log successful WebSocket connection
    logger.info(f"WebSocket connection established with {client_addr}")

    # Add the new client to the global clients set in a thread-safe manner
    # Using a lock ensures thread-safe access to the shared clients set
    with clients_lock:
        clients.add(websocket)
        logger.info(f"Active WebSocket connections: {len(clients)}")

    try:
        # Send a welcome message to the newly connected client
        # This informs the client that they've successfully connected to the UCAgent PTY
        welcome_msg = {
            "type": "output",
            "data": "Connected to UCAgent PTY WebSocket. Type commands to interact with UCAgent.\n"
        }
        await websocket.send(json.dumps(welcome_msg))

        # Main loop to handle incoming messages from the client
        # This async for loop will continue until the connection is closed
        async for message in websocket:
            try:
                # Parse the incoming JSON message
                # All messages from clients should be in JSON format
                data = json.loads(message)
                msg_type = data.get("type")

                # Handle input messages (commands from the client)
                if msg_type == "input":
                    command = data.get("data", "")

                    # Echo the command back to the client for confirmation
                    # This provides visual feedback that the command was received
                    echo_msg = {
                        "type": "echo",
                        "data": f"> {command}\n"
                    }
                    await websocket.send(json.dumps(echo_msg))

                    # Send the command to UCAgent asynchronously
                    # This queues the command for execution by the PTY input handler thread
                    response = await send_command_to_pdb_async(command)

                    # Send the response back to the client (optional - actual output comes from PTY)
                    # The actual command output will come through the PTY output reader
                    # This response is just a confirmation that the command was queued
                    output_msg = {
                        "type": "output",
                        "data": response
                    }
                    await websocket.send(json.dumps(output_msg))

                # Handle ping messages for connection health check
                elif msg_type == "ping":
                    # Respond with a pong message to indicate the server is alive
                    # This helps clients detect if the connection is still active
                    pong_msg = {"type": "pong", "data": "alive"}
                    await websocket.send(json.dumps(pong_msg))

            # Handle JSON parsing errors
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

            # Handle unexpected disconnections during message processing
            except ConnectionClosed:
                logger.info("Client disconnected during message processing")
                break

            # Handle any other exceptions during message processing
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

    # Handle expected disconnections
    except ConnectionClosed as e:
        logger.info(f"PTY client disconnected: code={e.code}, reason={e.reason}")

    # Handle any other exceptions in the handler
    except Exception as e:
        logger.error(f"Error in PTY handler: {e}")

    # Cleanup code that runs regardless of how the block was exited
    finally:
        # Explicitly close the WebSocket connection to prevent CLOSE_WAIT state
        # This ensures proper TCP connection termination
        try:
            if not websocket.closed:
                await websocket.close(code=1000, reason="Client disconnected")
        except Exception as e:
            logger.warning(f"Error closing WebSocket: {e}")

        # Remove the client from the global clients set in a thread-safe manner
        # This ensures the client is no longer included in broadcasts
        with clients_lock:
            clients.discard(websocket)
        logger.info(f"Client disconnected. Remaining clients: {len(clients)}")


async def websocket_handler(websocket):
    """
    Handle WebSocket connections for PTY communication.

    This function serves as an entry point for WebSocket connections, handling
    the initial connection setup and delegating the actual PTY communication
    to the pty_handler function. It also manages error handling and connection
    cleanup.

    Args:
        websocket: The WebSocket connection object for the client
    """
    # Extract client IP and port if available
    # This information is useful for logging and debugging purposes
    if hasattr(websocket, 'remote_address') and websocket.remote_address:
        client_ip = websocket.remote_address[0]
        client_port = websocket.remote_address[1]
    else:
        # Use default values if remote_address is not available
        client_ip = "unknown"
        client_port = 0

    # Log the connection attempt
    # This helps with monitoring and troubleshooting connection issues
    logger.info(f"Connection attempt from {client_ip}:{client_port}")

    # Log the WebSocket upgrade
    # This indicates that the HTTP connection has been successfully upgraded to WebSocket
    logger.info(f"Upgrading to WebSocket for {client_ip}:{client_port}")

    try:
        # Delegate to the PTY handler for actual WebSocket communication
        # The pty_handler function manages the ongoing communication with the client
        await pty_handler(websocket)
    except Exception as e:
        # Log any errors that occur in the PTY handler
        # This helps with debugging issues that occur during the communication
        logger.error(f"Error in pty_handler: {e}")
        try:
            # Close the WebSocket connection with an error code and reason
            # Code 1011 indicates an internal server error
            await websocket.close(code=1011, reason=f"Internal server error: {str(e)}")
        except:
            # Ignore any errors during the close operation
            # This prevents cascading errors if the connection is already closed
            pass


async def main(target="Adder"):
    """
    Main function to start the WebSocket server.

    This function sets up and runs the WebSocket server that enables PTY (pseudo-terminal)
    communication with the UCAgent process. It initializes the PTY, starts the necessary
    threads for handling PTY input/output, creates the WebSocket server, and manages
    graceful shutdown.

    Args:
        target (str): The Makefile target to build and run. Defaults to "Adder".
    """
    # Log the startup of the server
    logger.info("Starting UCAgent PTY WebSocket Server on port 8080...")

    # Set up signal handling for graceful shutdown
    def signal_handler(signum, frame):
        """
        Signal handler for SIGINT and SIGTERM signals.

        This function is called when the server receives a termination signal.
        It performs cleanup operations and cancels all running tasks.

        Args:
            signum: The signal number received
            frame: The current stack frame (not used)
        """
        # Log the received signal for debugging purposes
        logger.info(f"Received signal {signum}, shutting down...")

        # Clean up PTY resources to ensure proper termination
        cleanup_pty()

        # Get the current event loop and cancel all running tasks
        # This ensures a clean shutdown without hanging
        loop = asyncio.get_event_loop()
        for task in asyncio.all_tasks(loop):
            task.cancel()

    # Register the signal handler for SIGINT (Ctrl+C) and SIGTERM signals
    # This allows the server to respond gracefully to termination requests
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        # Setup the PTY and start UCAgent process
        # This creates the pseudo-terminal and launches the UCAgent process
        setup_pty(target)

        # Start the PTY output reader thread
        # This thread continuously reads output from the PTY and puts it in the message queue
        output_reader_thread = threading.Thread(target=pty_output_reader, daemon=True)
        output_reader_thread.start()
        logger.info("PTY output reader thread started")

        # Start the PTY input handler thread
        # This thread processes commands from the input queue and sends them to the PTY
        input_handler_thread = threading.Thread(target=pty_input_handler, daemon=True)
        input_handler_thread.start()
        logger.info("PTY input handler thread started")

        # Create WebSocket server
        # This sets up the server to listen for WebSocket connections
        server = await websockets.serve(
            websocket_handler,  # The handler function for WebSocket connections
            "127.0.0.1",        # Listen on localhost only for security
            8080,               # Port number to listen on
            ping_interval=20,   # Send a ping every 20 seconds to keep connections alive
            ping_timeout=40,    # Wait 40 seconds for a pong response before closing
            close_timeout=10,    # Wait 10 seconds for the connection to close
            origins=None,       # Disable origin checking completely
            max_size=2**20,     # Maximum message size (1MB)
            compression=None,   # Disable compression for better performance
            server_header="UCAgent-PTY-WebSocket/1.0"  # Custom server header
        )

        # Start the output broadcast task
        # This task broadcasts PTY output to all connected WebSocket clients
        broadcast_task = asyncio.create_task(broadcast_pty_output())

        logger.info("PTY WebSocket server listening on ws://127.0.0.1:8080")
        logger.info("Server is ready to accept connections")

        # Run both tasks concurrently
        # Wait for the server to close (this will block until the server is shut down)
        await server.wait_closed()
        # Wait for the broadcast task to complete
        await broadcast_task

    except Exception as e:
        # Handle any exceptions that occur during server startup or operation
        logger.error(f"Server startup failed: {e}")
        # Print the full traceback for debugging purposes
        import traceback
        traceback.print_exc()
    finally:
        # Clean up PTY resources regardless of how the try block exited
        cleanup_pty()
        logger.info("Server shutdown")


if __name__ == "__main__":
    import sys
    # Set event loop policy (needed on some systems)
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    # Get target from command line arguments, default to "Adder"
    target = sys.argv[1] if len(sys.argv) > 1 else "Adder"

    try:
        asyncio.run(main(target))
    except KeyboardInterrupt:
        logger.info("Shutting down PTY server...")
        cleanup_pty()
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        cleanup_pty()
        raise