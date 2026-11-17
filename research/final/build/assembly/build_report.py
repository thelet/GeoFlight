import json,re,sys
S=sys.argv[1]; out=sys.argv[2]; R='/home/user/GeoFlight/research'
src=json.load(open(R+'/sources.json'))
INTERNAL={'A1','A1Device','A2','A3a','A3b','A3c'}
src=[s for s in src if s['key'] not in INTERNAL]
json.dump(src,open(R+'/sources.json','w'),indent=1,ensure_ascii=False)
ch={i:open(f'{S}/ch{i}.md').read() for i in range(1,7)}
# insert Ch2 takeaways after chapter title
ch[2]=re.sub(r'\A(# Chapter 2: .*?\n\n)',lambda m:m.group(1)+open(S+'/ch2_takeaways.md').read()+'\n',ch[2])
# glossary
g=open(S+'/glossary_A2.md').read()
items=re.findall(r'^- \*\*.*$',g,re.M)+re.findall(r'^- \*\*.*$',open(S+'/gloss_extra.md').read(),re.M)
items=sorted(set(items),key=lambda x:re.sub(r'[^a-z0-9]','',x.lower()))
gl='# Glossary\n\n'+'\n'.join(items)+'\n'
# references
def fmt(i,s):
    a=s.get('authors') or ''; v=s.get('venue') or ''; y=s.get('year') or ''
    line=f"{i}. **[{s['key']}]** {a}. *{s.get('title','')}*. {v}, {y}."
    if s.get('url'): line+=f" <{s['url']}>"
    if s.get('code') and s.get('code')!=s.get('url'): line+=f" Code: <{s['code']}>"
    if s.get('license'): line+=f" Licence: {s['license']}."
    if not s.get('verified'): line+=" [UNVERIFIED metadata]"
    return line
refs='# References\n\nAll sources merged from the six chapters and de-duplicated by arXiv ID, title and URL (`research/sources.json`). Keys are cited inline in square brackets.\n\n'+'\n'.join(fmt(i+1,s) for i,s in enumerate(sorted(src,key=lambda s:s['key'].lower())))+'\n'
front=open(S+'/front.md').read()
doc=front+'\n\n'+'\n\n'.join(ch[i] for i in range(1,7))+'\n\n'+open(S+'/ch7.md').read()+'\n\n'+gl+'\n\n'+refs
# post-processing fixes
NOTE='> **Selection rules:** the binding frame-selection rules are the selection contract in §6.1.6 (Editorial note 7); the frame-selection step in this table is illustrative.\n\n'
for h in ('### 4.7 ','### 5.8 '):
    i=doc.index('\n'+h); j=doc.index('\n',i+1)+1
    doc=doc[:j]+'\n'+NOTE+doc[j:]
doc=doc.replace("Sections 1–5 build the mental model stage by stage","§2.1–§2.5 build the mental model stage by stage")
doc=doc.replace("Section 6 is a four-week learning path, Section 7 a glossary for tooltips, then widget suggestions, the handoff, and the source list.","§2.6 is a four-week learning path; the glossary is at the end of the report and the sources are in the References.")
doc=doc.replace('Keys are cited inline in square brackets.','Keys are cited inline in square brackets; a few entries (repositories, docs pages, DJI pages) are referenced through evidence tags such as [OPENED: …] or [SRC] rather than by key.')
# cited keys check
keys={s['key'] for s in src}
open(out,'w').write(doc)
cited=set()
for b in re.findall(r'\[([^\[\]\n]{1,300})\]',doc):
    for tok in re.split(r'[;,\s]+',b):
        if tok in keys: cited.add(tok)
print('words',len(doc.split()),'sources',len(src),'cited',len(cited),'uncited',len(keys-cited))
print('uncited sample',sorted(keys-cited)[:40])
