#!/usr/bin/python
"""
Interception proxy using MITM proxy.
"""

import asyncio
import queue
import json
import threading
import time
import traceback
import sys
import struct
import websockets
from mitmproxy import http

def convert_headers_to_bytes(header_entry):
    """
    Converts a tuple of strings into a tuple of bytes.
    """
    return [bytes(header_entry[0], "utf8"), bytes(header_entry[1], "utf8")]

def convert_body_to_bytes(body):
    """
    Converts a HTTP request/response body into a list of numbers.
    """
    if body is None:
        return bytes()
    else:
        return body

class WebSocketAdapter:
    """
    Relays HTTP/HTTPS requests to a websocket server.
    Enables using MITMProxy from outside of Python.
    """

    def websocket_thread(self):
        """
        Main function of the websocket thread. Runs the websocket event loop
        until MITMProxy shuts down.
        """
        #print("Starting websocket thread")
        self.event_loop.run_until_complete(self.websocket_loop())

    def __init__(self):
        self.event_loop = asyncio.get_event_loop()
        self.queue = queue.Queue()
        # self.log = mitmproxy.ctx.log
        # Start websocket thread
        threading.Thread(target=self.websocket_thread).start()

    def send_message(self, metadata, data1, data2):
        """
        Sends the given message on the WebSocket connection,
        and awaits a response. Metadata is a JSONable object,
        and data is bytes.
        """
        metadata_bytes = bytes(json.dumps(metadata), 'utf8')
        data1_size = len(data1)
        data2_size = len(data2)
        metadata_size = len(metadata_bytes)
        msg = struct.pack("<III" + str(metadata_size) + "s" +
                          str(data1_size) + "s" + str(data2_size) + "s",
                          metadata_size, data1_size, data2_size, metadata_bytes, data1, data2)
        obj = {
            'lock': threading.Condition(),
            'msg': msg,
            'response': None
        }
        # We use the lock to marry multithreading with asyncio.
        #print("acquiring lock")
        obj['lock'].acquire()
        #print("inserting into list")
        self.queue.put(obj)
        #print("waiting")
        obj['lock'].wait()
        #print("wait finished!")
        new_response = obj['response']
        if new_response is None:
            # Never got a response / an error occurred
            return None

        new_response_size = len(new_response)
        all_data = struct.unpack("<II" + str(new_response_size - 8) + "s", new_response)

        return (json.loads(all_data[2][0:all_data[0]]), all_data[2][all_data[0]:])

    def response(self, flow):
        """
        Intercepts an HTTP response. Mutates its headers / body / status code / etc.
        """
        print("Received a flow!")
        print(flow.request.url)
        request = flow.request
        response = flow.response
        message_response = self.send_message({
            'request': {
                'method': request.method,
                'url': request.url,
                'headers': list(request.headers.items(True)),
            },
            'response': {
                'status_code': response.status_code,
                'headers': list(response.headers.items(True)),
            }
        }, convert_body_to_bytes(request.content), convert_body_to_bytes(response.content))

        if message_response is None:
            print("No response received; making no modifications")
            return

        new_metadata = message_response[0]
        new_body = message_response[1]


        #print("Prepping response!")

        flow.response = http.HTTPResponse.make(
            new_metadata['status_code'],
            new_body,
            map(convert_headers_to_bytes, new_metadata['headers'])
        )
        print("Responding.")
        return

    def done(self):
        """
        Called when MITMProxy is shutting down.
        """
        # Tell the WebSocket loop to stop processing events
        self.queue.put(None)
        return

    async def websocket_loop(self):
        """
        Processes messages from self.queue until mitmproxy shuts us down.
        """
        while True:
            try:
                async with websockets.connect('ws://localhost:8765', max_size = None) as websocket:
                    print("[WS] connected to server")
                    while True:
                        print("[WS] waiting...")
                        # Make sure connection is still live.
                        await websocket.ping()
                        try:
                            obj = self.queue.get(timeout=1)
                            if obj is None:
                                break
                            print("[WS] Got item!")
                            try:
                                obj['lock'].acquire()
                                #print("[WS] Acquiring lock...")
                                #print("[WS] Sending message...")
                                await websocket.send(obj['msg'])
                                print("[WS] Waiting for response...")
                                obj['response'] = await websocket.recv()
                            finally:
                                # Always remember to wake up other thread + release lock to avoid deadlocks
                                obj['lock'].notify()
                                obj['lock'].release()
                        except queue.Empty:
                            pass
            except websockets.exceptions.ConnectionClosed:
                print("[WS] disconnected from server")
            except OSError:
                # Connect failed
                pass
            except:
                # print("[WS] Error, waiting before retrying connect...")
                print("[WS] Unexpected error:", sys.exc_info())
                traceback.print_exc(file=sys.stdout)

def start():
    """
    MITM 'start' hook lets us return an object with hooks defined.
    """
    wsa = WebSocketAdapter()
    return wsa
