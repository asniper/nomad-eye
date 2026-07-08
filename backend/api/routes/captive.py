import subprocess
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter(include_in_schema=False)


def _ap_url() -> str:
    result = subprocess.run(
        ["/usr/bin/nmcli", "-t", "-f", "IP4.ADDRESS", "dev", "show", "wlan0"],
        capture_output=True, text=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("IP4.ADDRESS"):
            val = line.split(":", 1)[-1].strip()
            if val:
                return f"http://{val.split('/')[0]}/setup"
    return "http://10.42.0.1/setup"


@router.get("/hotspot-detect.html")
@router.get("/library/test/success.html")
async def apple_captive():
    return Response(status_code=302, headers={"Location": _ap_url()})


@router.get("/generate_204")
@router.get("/gen_204")
async def android_captive():
    return Response(status_code=302, headers={"Location": _ap_url()})


@router.get("/connecttest.txt")
@router.get("/ncsi.txt")
async def windows_captive():
    return Response(status_code=302, headers={"Location": _ap_url()})
