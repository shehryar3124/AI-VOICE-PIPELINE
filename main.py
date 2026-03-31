from fastapi import FastAPI, WebSocket
import asyncio
import time

from stt import DeepgramSTT
from tts import DeepgramTTS
from llm import stream_llm_response

app = FastAPI()

class LatencyTracker:
    def __init__(self):
        self.reset()

    def reset(self):
        self.T0 = None
        self.T1 = None
        self.T2 = None
        self.T3 = None
        self.T4 = None
        self.T5 = None

    def log(self):
        print("\n⏱ Latency Breakdown:")
        print(f"T0 (transcript): {self.T0}")
        print(f"T1 (LLM request): {self.T1}")
        print(f"T2 (first token): {self.T2}")
        print(f"T3 (TTS start): {self.T3}")
        print(f"T4 (first audio): {self.T4}")
        print(f"T5 (playback): {self.T5}")

        if self.T0 and self.T5:
            print(f"\n🔥 Total Latency: {self.T5 - self.T0:.3f} sec\n")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    print("🔌 Client connected")

    tracker = LatencyTracker()

    async def handle_audio_chunk(audio_chunk):
        if tracker.T4 is None:
            tracker.T4 = time.time()
            print("🔊 First TTS audio received")

        if tracker.T5 is None:
            tracker.T5 = time.time()
            if tracker.T0:
                try:
                    await ws.send_json({
                        "type": "latency_breakdown",
                        "t0": tracker.T0,
                        "t1": tracker.T1,
                        "t2": tracker.T2,
                        "t3": tracker.T3,
                        "t4": tracker.T4,
                        "t5": tracker.T5,
                        "total": tracker.T5 - tracker.T0
                    })
                except Exception as e:
                    print(f"⚠️ Failed to send latency breakdown: {e}")

        try:
            await ws.send_bytes(audio_chunk)
        except Exception as e:
            print(f"⚠️ WebSocket closed (audio send): {e}")

    tts = DeepgramTTS(handle_audio_chunk)

    async def handle_llm(user_text):
        tracker.T1 = time.time()

        buffer = ""
        full_response = ""
        first_token = True

        async def on_token(token):
            nonlocal buffer, full_response, first_token
            full_response += token

            if first_token:
                tracker.T2 = time.time()
                print("⚡ First LLM token")
                first_token = False

            buffer += token

            # Optimized chunking for better voice prosody
            if token.endswith((".", "?", "!", ",", ";", ":", "\n")):
                if tracker.T3 is None:
                    tracker.T3 = time.time()
                    print("🗣 TTS started")

                await tts.send_text(buffer)
                buffer = ""

        await stream_llm_response(user_text, on_token)

        if buffer:
            await tts.send_text(buffer)

        try:
            await ws.send_json({
                "type": "response",
                "text": full_response
            })
        except Exception as e:
            print(f"⚠️ WebSocket closed (response send): {e}")

    async def handle_transcript(transcript):
        print("📝 Final transcript:", transcript)

        tracker.reset()
        tracker.T0 = time.time()

        try:
            await ws.send_json({
                "type": "transcript",
                "text": transcript
            })
        except Exception as e:
            print(f"⚠️ WebSocket closed (transcript send): {e}")

        await handle_llm(transcript)
        tracker.log()

    stt = DeepgramSTT(handle_transcript)
    
    await asyncio.gather(
        tts.connect(),
        stt.connect()
    )

    try:
        while True:
            audio = await ws.receive_bytes()
            await stt.send_audio(audio)
    except Exception as e:
        print(f"🔌 Connection closed: {e}")