import asyncio
import websockets
import json
import os
from dotenv import load_dotenv

load_dotenv()

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

class DeepgramSTT:
    def __init__(self, on_final_transcript):
        self.on_final_transcript = on_final_transcript
        self.ws = None

    async def connect(self):
        # Optimized for bilingual, restaurant orders, and natural pauses
        url = (
            "wss://api.deepgram.com/v1/listen"
            "?model=nova-2"
            "&language=multi"
            "&interim_results=true"
            "&keepalive=true"
            "&endpointing=500" 
        )

        print("🎤 Attempting to connect STT...")
        try:
            self.ws = await websockets.connect(
                url,
                extra_headers={"Authorization": f"Token {DEEPGRAM_API_KEY}"},
                open_timeout=30
            )
            print("🎤 STT connected")
            asyncio.create_task(self.receive())
        except Exception as e:
            print(f"❌ STT Connection Error: {e}")

    async def receive(self):
        try:
            async for message in self.ws:
                data = json.loads(message)

                transcript = (
                    data.get("channel", {})
                    .get("alternatives", [{}])[0]
                    .get("transcript", "")
                )

                if data.get("is_final") and transcript:
                    print("📝 Final:", transcript)
                    await self.on_final_transcript(transcript)
                    
        except websockets.exceptions.ConnectionClosedError as e:
            print(f"⚠️ Deepgram STT connection closed: {e}")
        except Exception as e:
            print(f"⚠️ Unexpected error in STT task: {e}")

    async def send_audio(self, audio_bytes):
        if self.ws and self.ws.open:
            await self.ws.send(audio_bytes)