🎙️ Call-Link: Real-Time Voice AI Pipeline
A high-performance, ultra-low latency conversational voice agent built with React, FastAPI, Deepgram, and OpenAI.

This project implements a fully cascaded STT → LLM → TTS pipeline using end-to-end WebSockets and raw PCM audio streaming. It is specifically optimized for bilingual (Urdu/English) restaurant ordering, featuring natural turn-taking, artifact-free audio playback, and sub-second response times.

🏗️ Architecture
The pipeline relies on a fully asynchronous, bidirectional WebSocket architecture to minimize Time To First Audio (TTFA).

Frontend (React): Captures microphone input and streams standard webm audio chunks to the backend. It receives raw binary audio chunks and decodes them natively using the Web Audio API.

Backend (FastAPI): Acts as the orchestrator.

STT (Deepgram Nova-2): Streams transcripts in real-time.

LLM (OpenAI GPT-4o-mini): Generates conversational responses and streams text tokens.

TTS (Deepgram Aura): Converts text tokens into raw 16-bit linear PCM audio and streams it back to the client.
------------------------------------------------------------------------------------------------------------------------------

Low-Latency & Audio Optimizations
Building a cascaded pipeline typically introduces significant latency and audio artifacts. The following engineering optimizations were applied to achieve native-level performance:

1. Raw PCM & Web Audio API Integration
Instead of waiting for complete MP3 or WAV files (which require headers and REST API blocking), the backend streams raw, uncompressed 16-bit linear PCM bytes directly to the frontend. The React app uses the AudioContext to decode and stitch these floats together in real-time, completely bypassing HTML5 <audio> player overhead.

2. The "Phase-Shift" Byte Stitcher
When streaming raw 16-bit audio over WebSockets, network packets often arrive with an odd number of bytes. If fed directly to a 16-bit decoder, this permanently shifts the phase of the audio stream, resulting in deafening static.

Fix: Implemented a leftoverByteRef in the frontend to temporarily cache hanging bytes and prepend them to the next incoming chunk, ensuring perfect 16-bit alignment.

3. Explicit Little-Endian Decoding
Browsers and OS architectures differ in byte-order processing. Deepgram streams in Little-Endian format.

Fix: Used a JavaScript DataView with the true flag (dataView.getInt16(i * 2, true)) to force Little-Endian decoding, preventing the browser from reading the audio waves backward and causing robotic distortion.

4. Native Sample Rate Matching
Requesting 48kHz audio from Deepgram's Aura models (which are natively trained at 24kHz) forces the server to artificially upsample the audio, increasing payload size and introducing metallic crunching.

Fix: Hardcoded both the Deepgram TTS WebSocket request and the frontend AudioBuffer to 24000 Hz, ensuring 1:1 bit-perfect playback and reducing bandwidth usage by 50%.

5. Dynamic Jitter Buffer
Because WebSocket packets arrive inconsistently due to network jitter, playing them instantly causes micro-stammers as the audio player temporarily starves.

Fix: Implemented a lightweight 100ms forward-looking jitter buffer (nextStartTimeRef.current = currentTime + 0.1) to absorb network hiccups and ensure buttery-smooth playback.

6. Semantic LLM Chunking
Sending text to the TTS engine based on character counts (e.g., every 20 chars) breaks natural voice prosody because the TTS engine generates inflection for incomplete phrases.

Fix: The LLM stream buffer only flushes to the TTS WebSocket when it hits natural linguistic boundaries (punctuation like ., ?, !, ,), resulting in highly realistic human inflection.

7. Concurrent Connection Initialization
Establishing SSL WebSocket handshakes takes time.

Fix: Used asyncio.gather() in FastAPI to connect to both Deepgram STT and TTS endpoints simultaneously upon client connection, effectively cutting backend setup time in half.

8. Microphone-First Setup
Browsers pause JavaScript execution while waiting for users to click "Allow Microphone". If the WebSocket connects first, Deepgram's STT engine hits its 10-second idle timeout and drops the connection (1011 Error) before the user can speak.

Fix: The React frontend explicitly awaits getUserMedia permissions before dialing the FastAPI WebSocket.
