"""Rebuild the bundled original exercises as a portable MIDI/MusicXML pair set.
No external musical corpus or engraving is used. MIDI is the preserved source.
"""
from pathlib import Path
import csv, hashlib, io, json, shutil, struct
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'panthesia-engine/assets'
PACK = ASSETS / 'starter-pack'
EXERCISES = [
    ('five-finger', '五指热身 · 从中央 C 开始', '入门/五指练习'),
    ('c-major-scale', 'C 大调音阶 · 一个八度', '入门/音阶'),
    ('bass-five-finger', '低音五指练习 · 左手音区', '入门/低音'),
    ('parallel-five-finger', '双音同步 · 两个八度五指', '入门/双音'),
    ('basic-chords', '三和弦练习 · C / F / G', '入门/和弦'),
]
def midi_notes(raw):
    if raw[:4] != b'MThd': raise ValueError('Invalid MIDI header')
    length, = struct.unpack('>I', raw[4:8]); ppq = int.from_bytes(raw[12:14], 'big')
    if ppq & 0x8000: raise ValueError('SMPTE is not supported in starter pack')
    offset = 8 + length; tracks = []
    while offset < len(raw):
        kind, length = raw[offset:offset+4], int.from_bytes(raw[offset+4:offset+8], 'big'); offset += 8
        stream = io.BytesIO(raw[offset:offset+length]); offset += length
        if kind != b'MTrk': raise ValueError('Invalid track')
        def variable():
            value = 0
            for _ in range(4):
                byte = stream.read(1)[0]; value = (value << 7) | (byte & 127)
                if byte < 128: return value
            raise ValueError('Invalid MIDI variable length')
        tick = 0; status = 0; active = {}; notes = []
        while stream.tell() < length:
            tick += variable(); first = stream.read(1)[0]
            if first & 128: status = first
            else: stream.seek(-1, 1)
            if status == 255:
                stream.read(1); stream.read(variable()); continue
            if status in (240,247): stream.read(variable()); continue
            op, channel = status & 240, status & 15
            data = stream.read(1 if op in (192,208) else 2)
            if op == 144 and data[1] > 0: active[(channel,data[0])] = tick
            elif op in (128,144):
                start = active.pop((channel,data[0]), None)
                if start is not None: notes.append((start,tick,data[0]))
        if active: raise ValueError('Unclosed notes')
        if notes: tracks.append(sorted(notes))
    return ppq, tracks

def child(parent, tag, value=None, **attrs):
    node = SubElement(parent, tag, attrs)
    if value is not None: node.text = str(value)
    return node

def make_score(title, ppq, tracks):
    root=Element('score-partwise', version='4.0')
    child(child(root,'work'),'work-title',title)
    identification=child(root,'identification')
    child(identification,'creator','Panthesia 原创练习',type='composer')
    child(identification,'rights','GPL-3.0-or-later; paired notation generated from bundled original MIDI')
    partlist=child(root,'part-list'); bar=ppq*4
    total=max(end for notes in tracks for _,end,_ in notes)
    for track,notes in enumerate(tracks):
        pid=f'P{track+1}'; child(child(partlist,'score-part',id=pid),'part-name','钢琴')
        part=child(root,'part',id=pid)
        for measure_index in range(max(1,(total+bar-1)//bar)):
            begin=measure_index*bar; end=begin+bar; measure=child(part,'measure',number=str(measure_index+1))
            if measure_index==0:
                attributes=child(measure,'attributes'); child(attributes,'divisions',ppq)
                child(child(attributes,'key'),'fifths',0)
                time=child(attributes,'time'); child(time,'beats',4); child(time,'beat-type',4)
                clef=child(attributes,'clef'); low=max(n[2] for n in notes)<60
                child(clef,'sign','F' if low else 'G'); child(clef,'line',4 if low else 2)
                direction=child(measure,'direction')
                metronome=child(child(direction,'direction-type'),'metronome')
                child(metronome,'beat-unit','quarter'); child(metronome,'per-minute',120)
                child(direction,'sound',tempo='120')
            cursor=begin; previous_start=None
            for start,finish,pitch in notes:
                if not begin<=start<end: continue
                if start % ppq or not 0 < finish-start <= ppq: raise ValueError('Starter exercises must use a quarter-note attack grid')
                # These authored exercises use quarter-note rhythm. MIDI release
                # gates (75/80 percent) describe articulation, not extra rests.
                finish=start+ppq
                if finish>end: raise ValueError('Cross-bar tie needs explicit source editing')
                chord=start==previous_start
                if start<cursor and not chord: raise ValueError('Overlapping voices need explicit source editing')
                if start>cursor:
                    rest=child(measure,'note'); child(rest,'rest'); child(rest,'duration',start-cursor)
                note=child(measure,'note')
                if chord: child(note,'chord')
                p=child(note,'pitch'); spelling=[('C',0),('C',1),('D',0),('E',-1),('E',0),('F',0),('F',1),('G',0),('A',-1),('A',0),('B',-1),('B',0)][pitch%12]
                child(p,'step',spelling[0])
                if spelling[1]: child(p,'alter',spelling[1])
                child(p,'octave',pitch//12-1); child(note,'duration',finish-start); child(note,'voice',1); child(note,'type','quarter')
                previous_start=start; cursor=max(cursor,finish)
            if cursor<end:
                for rest_start in range(cursor,end,ppq):
                    rest=child(measure,'note'); child(rest,'rest'); child(rest,'duration',ppq); child(rest,'type','quarter')
    indent(root,space='  ')
    output=io.BytesIO(); ElementTree(root).write(output,encoding='utf-8',xml_declaration=True)
    return output.getvalue()

def main():
    PACK.mkdir(exist_ok=True); manifest=[]
    for name,title,category in EXERCISES:
        raw=(ASSETS/f'{name}.mid').read_bytes(); ppq,tracks=midi_notes(raw)
        engraving_tracks = [[n for n in tracks[0] if n[2]>=60],[n for n in tracks[0] if n[2]<60]] if name=='parallel-five-finger' else tracks
        xml=make_score(title,ppq,engraving_tracks)
        (PACK/f'{name}.mid').write_bytes(raw); (PACK/f'{name}.musicxml').write_bytes(xml)
        manifest.append(dict(id=name,title=title,category=category,composer='Panthesia 原创练习',source='项目内置原创 MIDI',sourceUrl='https://github.com/Ubik42/Panthesia',license='GPL-3.0-or-later',quality='automaticDraft',review='音高与起音 tick 按源 MIDI 核对；记谱采用四分音符节奏，MIDI 原有 75%/80% 松键保留在演奏文件；教学指法与排版待人工校对',notes=sum(map(len,tracks)),ppq=ppq,midi=f'{name}.mid',score=f'{name}.musicxml',midiSha256=hashlib.sha256(raw).hexdigest(),scoreSha256=hashlib.sha256(xml).hexdigest()))
    (PACK/'manifest.json').write_text(json.dumps(dict(version=1,entries=manifest),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with (PACK/'catalog.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=['Category','Title','Composer','License','Source','SourceUrl','LocalPath'])
        writer.writeheader()
        for item in manifest: writer.writerow(dict(Category=item['category'],Title=item['title'],Composer=item['composer'],License=item['license'],Source=item['source'],SourceUrl=item['sourceUrl'],LocalPath=item['midi']))
    shutil.copyfile(ROOT/'LICENSE',PACK/'LICENSE')
    (PACK/'使用说明.txt').write_text('Panthesia 入门曲库\n\n五首项目内置原创练习，保留原 MIDI，附 MusicXML 配对谱。\n许可：GPL-3.0-or-later，见 LICENSE。来源及逐文件摘要见 manifest.json。\n配对谱为自动初稿，音高与起音 tick 按源 MIDI 核对。记谱采用四分音符节奏，MIDI 原有 75%/80% 松键时序保留在演奏文件。教学指法与排版尚未人工校对。\n\n程序曲库中可直接选择内置练习，配对谱自动接入。\n也可把本目录复制到个人曲库，在曲库中添加文件夹；在乐谱页选择同名 MusicXML。\n选“聆听”查看谱面跟随，切换“等待”用键盘练习。\n',encoding='utf-8-sig')
    print(f'Prepared {len(manifest)} paired exercises in {PACK}')
if __name__=='__main__': main()
