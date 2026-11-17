import re
SRC = '/home/user/GeoFlight/research/final/index.html'
OUT = '/tmp/claude-0/-home-user-GeoFlight/f8187839-754b-540f-9551-961219f5f0d9/scratchpad/avata360-garage-survey.html'
t = open(SRC).read()
head = t[t.index('<head>') + 6:t.index('</head>')]
body = t[t.index('<body'):t.index('</body>')]
bopen = re.match(r'<body[^>]*>', body).group(0)
body = body[len(bopen):]
head = re.sub(r'<meta charset="utf-8">\s*', '', head)
head = re.sub(r'<meta name="viewport"[^>]*>\s*', '', head)
body = re.sub(r'<script id="mermaid-lib"[^>]*></script>\s*', '', body)
body = re.sub(r'<script id="mermaid-init">.*?</script>\s*', '', body, flags=re.S)
out = head.strip() + '\n' + body.strip() + '\n'
open(OUT, 'w').write(out)
print(len(out) // 1024, 'KB; mermaid-lib left:', 'mermaid-lib' in out, '; body tag attrs:', bopen)
