from fastapi import Header, HTTPException

from config import API_KEY


async def verify_api_key(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "You didn't provide an API key.",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Invalid API key format. Expected 'Bearer <key>'",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    
    api_key = authorization.replace("Bearer ", "")
    if api_key != API_KEY:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Invalid API key provided",
                    "type": "invalid_request_error",
                    "param": None,
                    "code": "invalid_api_key"
                }
            }
        )
    return api_key
