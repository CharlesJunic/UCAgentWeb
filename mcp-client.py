import asyncio
import logging
import io
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

_client = None

# Global buffer to capture stdout/stderr
_output_buffer = io.StringIO()
_original_stdout = sys.stdout
_original_stderr = sys.stderr


class CapturingStream:
    """Custom stream class to capture output and redirect to original streams"""
    def __init__(self, original_stream, buffer):
        self.original_stream = original_stream
        self.buffer = buffer

    def write(self, s):
        # Write to the original stream (so it still appears in console)
        self.original_stream.write(s)
        # Also write to our buffer
        self.buffer.write(s)

    def flush(self):
        self.original_stream.flush()
        self.buffer.flush()

    def getvalue(self):
        return self.buffer.getvalue()

    def clear(self):
        current_value = self.buffer.getvalue()
        self.buffer = io.StringIO()  # Reset buffer
        return current_value


# Create capturing streams
capturing_stdout = CapturingStream(_original_stdout, _output_buffer)
capturing_stderr = CapturingStream(_original_stderr, _output_buffer)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan management function for the FastAPI application.
    Handles connecting to and disconnecting from the FastMCP server
    during application startup and shutdown, respectively.
    """
    global _client  # Declare the use of the global variable _client to maintain the client connection throughout the application lifecycle.

    # Redirect stdout and stderr to our capturing streams
    sys.stdout = capturing_stdout
    sys.stderr = capturing_stderr

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Connecting to FastMCP server (127.0.0.1:5000)...")  # Print connection attempt information.
    try:
        # Attempt to create an HTTP transport object and connect to the FastMCP server.
        # Uses the StreamableHttpTransport class to create a streamable HTTP connection object.
        transport = StreamableHttpTransport(url="http://127.0.0.1:5000/mcp")
        _client = Client(transport)  # Create a client instance using the transport object created above.
        await _client.__aenter__()  # Properly await the client connection
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Successfully connected to FastMCP server.")
    except Exception as e:
        # Error handling if the connection fails.
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to connect to FastMCP server: {e}")
        _client = None
    yield  # Yield control back to FastAPI; the application is now running.
    if _client:
        # Disconnect from the server when the application is shutting down.
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Disconnecting from FastMCP server...")
        await _client.__aexit__(None, None, None)  # Asynchronously close the connection.
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Disconnected.")
    _client = None  # Clean up the client instance.

    # Restore original stdout and stderr
    sys.stdout = _original_stdout
    sys.stderr = _original_stderr

# Create a FastAPI application instance
# - Set the title to "FastMCP Web Gateway"
# - Specify the lifespan function to manage startup and shutdown events
app = FastAPI(title="FastMCP Web Gateway", lifespan=lifespan)

# Add CORS (Cross-Origin Resource Sharing) middleware to the application
# This middleware enables handling of cross-origin requests from specified frontend origins
app.add_middleware(
    CORSMiddleware,
    # List of allowed origins (frontend URLs that can access this API)
    allow_origins=["http://127.0.0.1:5173"],  # Typically a local development server address
    # Allow cookies and authentication headers to be included in cross-origin requests
    allow_credentials=True,
    # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.) in cross-origin requests
    allow_methods=["*"],
    # Allow all HTTP headers in cross-origin requests
    allow_headers=["*"],
)

class ToolCallRequest(BaseModel):
    """
    Tool call request model class.
    Defines the parameter structure required when invoking a tool.
    """
    tool_name: str  # Tool name, specifies the specific tool to be called
    arguments: dict  # Tool parameters, passed as a dictionary containing the arguments needed for the tool call

class PromptRequest(BaseModel):
    """
    Prompt request model class.
    Defines the parameter structure required when requesting user input via a prompt.
    """
    prompt_type: str  # Type of prompt (e.g., "text", "confirm", "select")
    message: str      # Message to display to the user
    options: list = []  # Options for select-type prompts

# Root endpoint - returns basic API information and connection status
@app.get("/")
async def root():
    return {
        "service": "FastMCP Web Gateway",
        "status": "running" if _client else "client_not_connected",  # Check if MCP client is connected
        "target_server": "http://127.0.0.1:5000/mcp"  # The FastMCP server this gateway connects to
    }

# Endpoint to list all available tools from the MCP server
@app.get("/tools")
async def list_tools():
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected.")  # Service unavailable if client not connected
    try:
        tools = await _client.list_tools()  # Fetch tools list from MCP server
        tools_list = []
        for tool in tools:
            tools_list.append({
                "name": tool.name,  # Tool identifier
                "description": tool.description,  # What the tool does
                "inputSchema": tool.inputSchema  # Expected input parameters schema
            })
        return {"tools": tools_list}
    except Exception as e:
        logging.error(f"Failed to list tools: {e}")  # Log the error for debugging
        raise HTTPException(status_code=500, detail=f"Failed to call MCP service: {str(e)}")  # Internal server error

# Endpoint to list all available resources from the MCP server
@app.get("/resources")
async def list_resources():
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected.")  # Service unavailable if client not connected
    try:
        resources = await _client.list_resources()  # Fetch resources list from MCP server
        return {"resources": [{"uri": r.uri, "name": r.name} for r in resources]}  # Extract URI and name for each resource
    except Exception as e:
        logging.error(f"Failed to list resources: {e}")  # Log the error for debugging
        raise HTTPException(status_code=500, detail=f"Failed to call MCP service: {str(e)}")  # Internal server error

# Endpoint to call a specific tool with provided arguments
@app.post("/tools/call")
async def call_tool(request: ToolCallRequest):
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected")  # Service unavailable if client not connected
    if not request.tool_name:
        raise HTTPException(status_code=400, detail="tool_name is required")  # Bad request if tool name is missing

    try:
        print(f"User called tool {request.tool_name} with arguments {request.arguments}")  # Log the tool call for auditing
        result = await _client.call_tool(request.tool_name, request.arguments)  # Call the tool via MCP client
        return {"result": result}
    except Exception as e:
        logging.error(f"Failed to call tool: {e}")  # Log the error for debugging
        raise HTTPException(status_code=500, detail=f"Failed to call tool: {str(e)}")  # Internal server error

# Endpoint to get a resource by URI
@app.get("/resources/{uri:path}")
async def get_resource(uri: str):
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected")

    try:
        # Decode the URI to handle special characters
        import urllib.parse
        decoded_uri = urllib.parse.unquote(uri)

        # List all resources to check if the requested one exists
        resources = await _client.list_resources()
        resource_exists = any(r.uri == decoded_uri for r in resources)

        if not resource_exists:
            raise HTTPException(status_code=404, detail=f"Resource {decoded_uri} not found")

        # For now, we'll return a message indicating the resource exists
        # since the actual reading mechanism depends on the specific resource type
        return {"uri": decoded_uri, "content": f"Resource {decoded_uri} exists and is accessible"}
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to access resource {uri}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to access resource: {str(e)}")

# Endpoint to send a notification to the MCP server
@app.post("/notifications/send")
async def send_notification(message: str, level: str = "info"):
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected")

    try:
        # Send a notification to the MCP server
        # Note: The actual implementation depends on the specific MCP server capabilities
        # For now, we'll just log the notification
        print(f"[NOTIFICATION {level.upper()}] {message}")
        return {"status": "notification_sent", "message": message, "level": level}
    except Exception as e:
        logging.error(f"Failed to send notification: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send notification: {str(e)}")

# Endpoint to request user input via a prompt
@app.post("/prompts/request")
async def request_prompt(request: PromptRequest):
    if not _client:
        raise HTTPException(status_code=503, detail="MCP client is not connected")

    try:
        # For now, we'll simulate the prompt by returning a mock response
        # In a real implementation, this would interact with the MCP server's prompting capabilities
        print(f"Prompt requested: {request.message}")

        # Return a mock response based on prompt type
        if request.prompt_type == "confirm":
            return {"response": True, "cancelled": False}
        elif request.prompt_type == "select":
            return {"response": request.options[0] if request.options else "", "cancelled": False}
        else:  # text or other
            return {"response": "Sample response", "cancelled": False}
    except Exception as e:
        logging.error(f"Failed to handle prompt request: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to handle prompt: {str(e)}")

# Endpoint to get captured output
@app.get("/output")
async def get_output():
    """
    Returns the captured stdout/stderr output from the running process.
    """
    return {"output": capturing_stdout.getvalue()}

# Endpoint to clear captured output
@app.post("/output/clear")
async def clear_output():
    """
    Clears the captured output buffer.
    """
    capturing_stdout.clear()
    return {"message": "Output cleared"}

# Health check endpoint - verifies connection to MCP server
@app.get("/health")
async def health_check():
    """
    Performs a health check to verify the connection status between the MCP client and server.
    Returns a dictionary containing the status and message.
    """
    if not _client:  # Check if the client has been initialized.
        return {"status": "disconnected", "message": "MCP client not initialized"}
    try:
        await _client.ping()  # Attempt to send a ping request to the server.
        return {"status": "connected", "message": "MCP server is reachable"}  # Return on successful connection.
    except Exception as e:  # Catch all possible exceptions.
        return {"status": "error", "message": f"MCP server unreachable: {str(e)}"}  # Return error message on connection failure.

# Application entry point
if __name__ == "__main__":
    import uvicorn
    print("Starting FastMCP API server...")
    # Start the FastAPI server with uvicorn
    # - Host: localhost (127.0.0.1)
    # - Port: 8000
    # - Reload: Automatically restart server on code changes (development mode)
    uvicorn.run("mcp-client:app", host="127.0.0.1", port=8000, reload=True)