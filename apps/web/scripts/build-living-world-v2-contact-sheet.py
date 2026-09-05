"""Lay out unedited QA screenshots into a labelled overview (full originals retained)."""
from pathlib import Path
import shutil
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1] / 'outputs/living-world-v2'
SOURCE = ROOT / 'after'
# Normalize baseline filenames using actual pixel width, never infer hashed test folders.
for source in (ROOT/'before/journey').glob('*/*.png'):
    with Image.open(source) as original:
        width = original.width
    if source.stem != '02-closed-book':
        shutil.copyfile(source, ROOT/'before'/f'{source.stem}-{width}.png')
items = [('hero-390','Вход в книгу'),('first-choice-390','Первая страница'),
         ('03-capture-390','Запись истории'),('05-question-390','Уточняющий вопрос'),
         ('06-story-preview-390','Предложение / проверка'),('07-reader-390','Чтение истории'),
         ('09-book-390','Моя книга'),('10-book-plan-390','Структура книги'),
         ('11-style-390','Стиль'),('12-privacy-390','Приватность'),
         ('13-export-390','Экспорт'),('feedback-390','Голосовая обратная связь')]
canvas = Image.new('RGB',(1200,2070),'#17271d')
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',21)
title = ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',35)
draw.text((30,24),'КтоЯ · Один живой мир',font=title,fill='#f0e4c9')
draw.text((30,76),'V2 · живые листы · реальные экраны · полные оригиналы — в after/',font=font,fill='#c2c8ac')
for i,(name,label) in enumerate(items):
    x=30+(i%4)*292
    y=130+(i//4)*638
    with Image.open(SOURCE/f'{name}.png') as original:
        viewport=original.crop((0,0,original.width,min(original.height,844)))
        thumbnail=ImageOps.contain(viewport,(264,572))
        canvas.paste(thumbnail,(x,y))
    draw.text((x,y+585),label,font=font,fill='#f0e4c9')
canvas.save(ROOT/'contact-sheet.png')
lines = ['# Living World v2 screenshot index', '', 'Actual local QA captures. `before` is baseline 23908bf; `before-living-pages` is intermediate 9d45c2e; `after` is the final living-pages candidate.',
         'Baseline feedback component is the unchanged dialog DOM with v1 CSS restored; it is not a separate baseline deployment.', '']
for directory in ['before','before-living-pages','after','visual']:
    lines.extend([f'## {directory}', ''])
    for shot in sorted((ROOT/directory).glob('*.png')):
        lines.append(f'- [{shot.name}]({shot.as_posix()})')
    lines.append('')
(ROOT/'SCREENSHOTS.md').write_text('\n'.join(lines),encoding='utf-8')
print(ROOT/'contact-sheet.png')
