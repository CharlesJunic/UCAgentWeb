#!/usr/bin/env python3
"""
WebSocket Server for UCAgent Terminal
This server creates a WebSocket endpoint that simulates terminal interaction
with UCAgent by forwarding commands through named pipes.
"""

import asyncio
import json
import logging
import os
import threading
from typing import Dict

import websockets
from websockets.exceptions import ConnectionClosed

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global variables
clients = set()

# Named pipes location
PIPE_DIR = "output/pipes"
INPUT_PIPE_PATH = os.path.join(PIPE_DIR, "agent_input_pipe")
OUTPUT_PIPE_PATH = os.path.join(PIPE_DIR, "agent_output_pipe")

# Global output reader thread
output_reader_thread = None
stop_output_reading = threading.Event()

async def send_command_to_agent(command: str):
    """Send a command to UCAgent via named pipes."""
    try:
        # Write command to input pipe
        with open(INPUT_PIPE_PATH, 'w') as input_pipe:
            input_pipe.write(command + '\n')
            input_pipe.flush()

        # For immediate commands like 'loop', just acknowledge
        if command.strip() == 'loop':
            return f"Command '{command}' sent to agent.\n"
        else:
            return f"Command '{command}' sent to agent.\n"
    except FileNotFoundError:
        logger.error("Named pipe not found. Is UCAgent running?")
        return "Error: Cannot connect to UCAgent. Named pipe not found.\n"
    except Exception as e:
        logger.error(f"Error sending command to agent: {e}")
        return f"Error sending command: {str(e)}\n"

def output_reader():
    """Thread function to read output from the agent and broadcast to all clients."""
    global clients

    try:
        while not stop_output_reading.is_set():
            try:
                with open(OUTPUT_PIPE_PATH, 'r') as output_pipe:
                    while not stop_output_reading.is_set():
                        line = output_pipe.readline()
                        if line:
                            # Prepare message for WebSocket
                            output_msg = json.dumps({
                                "type": "output",
                                "data": line
                            })

                            # Broadcast to all connected clients
                            clients_to_remove = set()
                            for client in clients.copy():
                                try:
                                    client.send(output_msg)
                                except Exception as e:
                                    logger.warning(f"Error sending to client: {e}")
                                    clients_to_remove.add(client)

                            # Remove disconnected clients
                            for client in clients_to_remove:
                                clients.discard(client)
                        else:
                            # Small delay to prevent busy waiting
                            import time
                            time.sleep(0.01)
            except FileNotFoundError:
                logger.warning("Output pipe not found, retrying in 1 second...")
                import time
                time.sleep(1)
            except Exception as e:
                logger.error(f"Error reading from output pipe: {e}")
                import time
                time.sleep(1)
    except Exception as e:
        logger.error(f"Output reader thread error: {e}")

async def terminal_handler(websocket, path):
    """Handle WebSocket connections for terminal communication."""
    global clients
    clients.add(websocket)
    logger.info(f"New terminal client connected. Total clients: {len(clients)}")

    try:
        # Send welcome message
        welcome_msg = json.dumps({
            "type": "output",
            "data": "Connected to UCAgent terminal via WebSocket. Type commands to interact with the agent.\n"
        })
        await websocket.send(welcome_msg)

        # Main loop to handle messages
        async for message in websocket:
            try:
                # Parse the incoming message
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "input":
                    command = data.get("data", "")

                    # Echo the command back to the sender
                    echo_msg = json.dumps({
                        "type": "echo",
                        "data": f"> {command}\n"
                    })
                    await websocket.send(echo_msg)

                    # Send the command to UCAgent via named pipes
                    response = await send_command_to_agent(command)

                    # Send the response back to the client
                    output_msg = json.dumps({
                        "type": "output",
                        "data": response
                    })
                    await websocket.send(output_msg)

                elif msg_type == "ping":
                    # Respond to ping
                    pong_msg = json.dumps({"type": "pong", "data": "alive"})
                    await websocket.send(pong_msg)

            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received from client")
                error_msg = json.dumps({
                    "type": "error",
                    "data": f"Invalid JSON: {message[:100]}..."
                })
                try:
                    await websocket.send(error_msg)
                except:
                    pass  # Ignore errors when trying to send error message
            except Exception as e:
                logger.error(f"Error processing message from client: {e}")
                error_msg = json.dumps({
                    "type": "error",
                    "data": f"Error processing command: {str(e)}"
                })
                try:
                    await websocket.send(error_msg)
                except:
                    pass  # Ignore errors when trying to send error message

    except ConnectionClosed:
        logger.info(f"Terminal client disconnected")
    except Exception as e:
        logger.error(f"Error in terminal handler: {e}")
    finally:
        clients.discard(websocket)
        logger.info(f"Client disconnected. Remaining clients: {len(clients)}")

async def main():
    """Main function to start the WebSocket server."""
    global output_reader_thread

    logger.info("Starting UCAgent Terminal WebSocket Server on port 8080...")

    # Start the output reader thread
    stop_output_reading.clear()
    output_reader_thread = threading.Thread(target=output_reader, daemon=True)
    output_reader_thread.start()

    # Start the WebSocket server
    server = await websockets.serve(terminal_handler, "127.0.0.1", 8080)
    logger.info("WebSocket server listening on ws://127.0.0.1:8080")

    try:
        await server.wait_closed()
    except KeyboardInterrupt:
        logger.info("Shutting down server...")
        stop_output_reading.set()
        if output_reader_thread:
            output_reader_thread.join(timeout=2)

if __name__ == "__main__":
    asyncio.run(main())