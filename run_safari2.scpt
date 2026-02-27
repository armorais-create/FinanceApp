tell application "Safari"
    make new document with properties {URL:"http://localhost:8000/test_syntax.html"}
    delay 6
    set pageContent to source of document 1
    return pageContent
end tell
