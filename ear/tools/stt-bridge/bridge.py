"""Igor — Home Assistant's speech-to-text on the ear VM's GPU.

A Wyoming server (the protocol Home Assistant's voice pipelines speak) that
hands each recording to the whisper.cpp server already running on this VM
(Vulkan, Radeon VII) and returns its text. Nothing leaves the house: the
audio goes from Home Assistant to this VM, and the text back.

    python3 bridge.py --uri tcp://0.0.0.0:10300 --whisper http://127.0.0.1:8178 --language fr
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import time
import urllib.request
import uuid
import wave
from functools import partial

from wyoming.asr import Transcript
from wyoming.audio import AudioChunk, AudioChunkConverter, AudioStart, AudioStop
from wyoming.event import Event
from wyoming.info import AsrModel, AsrProgram, Attribution, Describe, Info
from wyoming.server import AsyncEventHandler, AsyncServer

LOG = logging.getLogger("igor-stt")
# whisper.cpp wants 16 kHz, 16-bit, mono.
TO_WHISPER = AudioChunkConverter(rate=16000, width=2, channels=1)


def transcribe(whisper_url: str, wav: bytes, language: str) -> str:
    """POST a WAV file to whisper.cpp's /inference and return its text."""
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in (("response_format", "json"), ("temperature", "0.0"), ("language", language)):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n".encode()
    )
    parts.append(wav)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        f"{whisper_url.rstrip('/')}/inference",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return str(json.loads(response.read()).get("text", "")).strip()


class Handler(AsyncEventHandler):
    def __init__(self, info: Info, args: argparse.Namespace, *rest, **kwargs) -> None:
        super().__init__(*rest, **kwargs)
        self.info = info
        self.args = args
        self.audio = io.BytesIO()

    async def handle_event(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            await self.write_event(self.info.event())
            return True
        if AudioStart.is_type(event.type):
            self.audio = io.BytesIO()
            return True
        if AudioChunk.is_type(event.type):
            self.audio.write(TO_WHISPER.convert(AudioChunk.from_event(event)).audio)
            return True
        if AudioStop.is_type(event.type):
            pcm = self.audio.getvalue()
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(16000)
                out.writeframes(pcm)
            started = time.monotonic()
            try:
                text = await asyncio.get_running_loop().run_in_executor(
                    None, transcribe, self.args.whisper, buffer.getvalue(), self.args.language
                )
            except Exception as err:  # noqa: BLE001 - an empty transcript, never a dropped pipeline
                LOG.warning("whisper failed: %s", err)
                text = ""
            LOG.info("%.1f s of audio → %.1f s: %r", len(pcm) / 32000, time.monotonic() - started, text[:80])
            await self.write_event(Transcript(text=text).event())
            return False
        return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default="tcp://0.0.0.0:10300")
    parser.add_argument("--whisper", default="http://127.0.0.1:8178")
    parser.add_argument("--language", default="fr")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    attribution = Attribution(name="whisper.cpp", url="https://github.com/ggml-org/whisper.cpp")
    info = Info(
        asr=[
            AsrProgram(
                name="igor-stt",
                description="Whisper on the ear VM's GPU",
                attribution=attribution,
                installed=True,
                version="1.0",
                models=[
                    AsrModel(
                        name="whisper-gpu",
                        description="whisper.cpp (Vulkan)",
                        attribution=attribution,
                        installed=True,
                        version="1.0",
                        languages=[args.language],
                    )
                ],
            )
        ]
    )
    server = AsyncServer.from_uri(args.uri)
    LOG.info("listening on %s, whisper at %s", args.uri, args.whisper)
    asyncio.run(server.run(partial(Handler, info, args)))


if __name__ == "__main__":
    main()
