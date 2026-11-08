"""
Launcher script for Unlimited-OCR Microservice.
Usage:
    python run_server.py --port 8000 --host 127.0.0.1
"""

import argparse
import sys
import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Jalankan server Unlimited-OCR untuk MyDuit PWA")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Auto reload saat kode berubah")

    args = parser.parse_args()
    print(f"==================================================")
    print(f"🚀 Menjalankan Unlimited-OCR Server di http://{args.host}:{args.port}")
    print(f"Endpoint Health: http://{args.host}:{args.port}/health")
    print(f"Endpoint Parse:  http://{args.host}:{args.port}/api/v1/parse-receipt")
    print(f"==================================================")

    try:
        uvicorn.run("app:app", host=args.host, port=args.port, reload=args.reload)
    except KeyboardInterrupt:
        print("\n[Unlimited-OCR] Server dimatikan oleh pengguna.")
        sys.exit(0)
