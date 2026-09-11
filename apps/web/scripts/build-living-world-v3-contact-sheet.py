"""Label actual QA viewport crops; preserve full screenshots and v2 references."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

root=Path(__file__).resolve().parents[1]/'outputs/living-world-v3'
items=[('hero-390','Вход в книгу'),('03-capture-390','Запись истории'),
       ('multi-fragment-no-ai-390','Два аудиофрагмента'),('05-question-390','Уточняющий вопрос'),
       ('06-story-preview-390','Предложение'),('08b-correction-instruction-390','Точечная правка'),
       ('07-reader-390','Чтение'),('09-book-390','Моя книга'),
       ('10-book-plan-390','Структура'),('11-style-390','Стиль'),
       ('13-export-390','Экспорт'),('feedback-390','Голосовой отзыв')]
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
title=ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',34)
canvas=Image.new('RGB',(1200,2070),'#17271d');draw=ImageDraw.Draw(canvas)
draw.text((30,24),'КтоЯ · Живая книга · V3',font=title,fill='#f0e4c9')
draw.text((30,76),'Реальные локальные экраны · фрагменты первого viewport · не live LLM QA',font=font,fill='#c2c8ac')
for i,(name,label) in enumerate(items):
    x=30+i%4*292;y=130+i//4*638
    with Image.open(root/'after'/f'{name}.png') as shot:
        crop=shot.crop((0,0,shot.width,min(shot.height,844)))
        canvas.paste(ImageOps.contain(crop,(264,572)),(x,y))
    draw.text((x,y+585),label,font=font,fill='#f0e4c9')
canvas.save(root/'contact-sheet.png')
comparison=Image.new('RGB',(1400,1500),'#17271d');draw=ImageDraw.Draw(comparison)
draw.text((25,20),'V2 → V3 · До / после',font=title,fill='#f0e4c9')
for row,name in enumerate(['hero-1600','03-capture-1600','07-reader-1024']):
    for col,folder in enumerate(['before','after']):
        with Image.open(root/folder/f'{name}.png') as shot:
            crop=shot.crop((0,0,shot.width,min(shot.height,shot.width*.65)))
            comparison.paste(ImageOps.contain(crop,(665,425)),(25+col*700,100+row*465))
comparison.save(root/'before-after.png')
print(root/'contact-sheet.png')
print(root/'before-after.png')
