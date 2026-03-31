from openai import AsyncOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

conversation = [
    {
        "role": "system",
        "content": "You are a fast, natural voice assistant . Keep responses short and conversational."
    }
]

async def stream_llm_response(user_text, on_token):
    conversation.append({"role": "user", "content": user_text})

    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=conversation,
        stream=True
    )

    full_response = ""

    async for chunk in stream:
        if chunk.choices and len(chunk.choices) > 0:
            token = chunk.choices[0].delta.content
            if token:
                full_response += token
                await on_token(token)

    conversation.append({"role": "assistant", "content": full_response})