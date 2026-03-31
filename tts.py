import asyncio
import websockets
import json
import os
from dotenv import load_dotenv

load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

class DeepgramTTS:
    def __init__(self, on_audio_chunk):
        self.on_audio_chunk = on_audio_chunk
        self.ws = None

    async def connect(self):
        # Native 24,000 Hz to prevent Deepgram upsampling distortion
        url = "wss://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=linear16&sample_rate=24000"
        
        print("🔊 Attempting to connect TTS...")
        try:
            self.ws = await websockets.connect(
                url,
                extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                open_timeout=30
            )
            print("🔊 TTS connected (Streaming WebSocket mode)")
            asyncio.create_task(self.receive_audio())
        except asyncio.TimeoutError:
            print("❌ TTS Connection Error: Deepgram timed out after 30 seconds.")
        except Exception as e:
            print(f"❌ TTS Connection Error: {e}")

    async def receive_audio(self):
        try:
            async for message in self.ws:
                if isinstance(message, bytes):
                    await self.on_audio_chunk(message)
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"⚠️ Deepgram TTS connection closed: {e}")
        except Exception as e:
            print(f"⚠️ Unexpected error in TTS task: {e}")

    async def send_text(self, text):
        if not self.ws or not self.ws.open:
            print("🔄 TTS socket closed or idle. Reconnecting...")
            await self.connect()

        try:
            if self.ws and self.ws.open:
                await self.ws.send(json.dumps({
                    "type": "Speak",
                    "text": text
                }))
        except Exception as e:
            print(f"❌ Failed to send text to TTS: {e}")