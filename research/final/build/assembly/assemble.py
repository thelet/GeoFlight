import json,re,sys
R='/home/user/GeoFlight/research'
S=sys.argv[1]
km=json.load(open(S+'/key_map.json'))
CH={'A1':1,'A2':2,'A3a':3,'A3b':4,'A3c':5,'A4':6}
FILES={'A1':'A1_device.md','A2':'A2_foundations.md','A3a':'A3a_filtering.md','A3b':'A3b_geometry.md','A3c':'A3c_visualization.md','A4':'A4_system_design.md'}
TITLES={1:'The camera and drone',2:'Foundations',3:'Data filtering and quality-aware selection',4:'Geometric accuracy',5:'Realistic visualization',6:'Full-system options'}
AG=r'(A3a|A3b|A3c|A1|A2|A4)'
def split_code(t):
    # yields (is_code, text)
    parts=re.split(r'(```.*?```)',t,flags=re.S)
    return [(p.startswith('```'),p) for p in parts]
def drop_section(t,pat):
    m=re.search(r'^## '+pat+r'.*?$',t,re.M)
    if not m: return t,None
    n=re.search(r'^## ',t[m.end():],re.M)
    end=m.end()+n.start() if n else len(t)
    return t[:m.start()]+t[end:], t[m.start():end]
out={}
glossary=None
for ag,fn in FILES.items():
    c=CH[ag]; t=open(f'{R}/{fn}').read()
    t=re.sub(r'\n## Handoff.*\Z','\n',t,flags=re.S)           # handoff + json
    t,_=drop_section(t,r'(\d+\. )?Interactive component suggestions')
    if ag=='A2':
        t,glossary=drop_section(t,r'7\. Glossary')
    t=re.sub(r'\A# .*?\n','',t)                               # title
    t=re.sub(r'\A\s*\*[^\n]*\*\s*\n','',t)                    # italic byline
    t=re.sub(r'^## 0\. TL;DR.*$','### Key takeaways',t,flags=re.M)
    segs=[]
    for code,p in split_code(t):
        if code: segs.append(p); continue
        # cite keys
        m=km.get(ag,{})
        def fixbr(mb):
            s=mb.group(0)
            for old,new in m.items():
                if old!=new and old in s:
                    s=re.sub(r'(?<![A-Za-z0-9_\-])'+re.escape(old)+r'(?![A-Za-z0-9_\-])',new,s)
            return s
        p=re.sub(r'\[[^\[\]\n]{1,300}\]',fixbr,p)
        # agent-qualified § refs
        p=re.sub(AG+r"(?:'s)?\s+(?:§|section\s+|Section\s+)(\d+(?:\.\d+)*)",lambda mm:f'§\x00{CH[mm.group(1)]}.{mm.group(2)}',p)
        for _ in range(4):
            p=re.sub(r'(§\x00(\d+)\.[\d.]*\d(?:,\s*§\x00\2\.[\d.]*\d)*)((?:,\s*|\s+and\s+))§(\d+(?:\.\d+)*)',lambda mm:f'{mm.group(1)}{mm.group(3)}§\x00{mm.group(2)}.{mm.group(4)}',p)
        p=re.sub(r'§(?!\x00)(\d+(?:\.\d+)*)',lambda mm:f'§{c}.{mm.group(1)}',p)
        p=re.sub(r'§(\d+(?:\.\d+)*)–(\d+(?:\.\d+)*)',lambda mm:f'§{mm.group(1)}–{c}.{mm.group(2)}' ,p)
        p=p.replace('\x00','')
        # headings
        p=re.sub(r'^(#{2,4}) (\d+)\.(\d+(?:\.\d+)*)?\.? ?',lambda mm:'#'+mm.group(1)+f' {c}.{mm.group(2)}'+('.'+mm.group(3) if mm.group(3) else '')+' ',p,flags=re.M)
        p=re.sub(r'^(#{2,4}) (?!\d)',lambda mm:'#'+mm.group(1)+' ',p,flags=re.M)
        # agent ids -> chapters
        p=re.sub(r'\[UPSTREAM '+AG+r'([^\]]*)\]',lambda mm:f'[see Ch. {CH[mm.group(1)]}{mm.group(2)}]',p)
        p=re.sub(r'\b'+AG+r'(?:\'s)? [Hh]andoff\b',lambda mm:f'Ch. {CH[mm.group(1)]}',p)
        p=re.sub(r'(?<![\w/.\-])'+AG+r'(?![\w\-]|\s+paper|\s+sheet)',lambda mm:f'Ch. {CH[mm.group(1)]}',p)
        segs.append(p)
    t=''.join(segs).strip()+'\n'
    t=t.replace('#### Key takeaways','### Key takeaways')
    out[c]=t
json.dump({str(k):v for k,v in out.items()},open(S+'/chapters.json','w'))
open(S+'/glossary_A2.md','w').write(glossary or '')
for c,t in out.items():
    open(f'{S}/ch{c}.md','w').write(f'# Chapter {c}: {TITLES[c]}\n\n'+t)
    print(c,len(t.split()))
