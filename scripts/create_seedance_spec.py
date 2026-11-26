from pathlib import Path
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUT = Path(r"D:\AIProject\Video\Seedance数字人视频技术要求.docx")


def set_font(run, name="Microsoft YaHei", size=10.5, bold=False, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run._element.rPr.rFonts.set(qn("w:ascii"), name)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    run.font.size = Pt(size)
    run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_border(cell, color="D9D9D9"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        element = borders.find(tag)
        if element is None:
            element = OxmlElement(f"w:{edge}")
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:color"), color)


def style_cell(cell, header=False):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for p in cell.paragraphs:
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.space_before = Pt(3)
        for r in p.runs:
            set_font(r, size=9.5, bold=header, color=(255, 255, 255) if header else None)
    if header:
        shade(cell, "1F4E78")
    set_cell_border(cell)


def add_heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.style = f"Heading {level}"
    p.paragraph_format.space_before = Pt(12 if level == 1 else 8)
    p.paragraph_format.space_after = Pt(5)
    r = p.add_run(text)
    set_font(r, size=14 if level == 1 else 11.5, bold=True)
    return p


def add_body(doc, text, bold_lead=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.25
    if bold_lead and text.startswith(bold_lead):
        r = p.add_run(bold_lead)
        set_font(r, bold=True)
        r = p.add_run(text[len(bold_lead):])
        set_font(r)
    else:
        r = p.add_run(text)
        set_font(r)
    return p


def add_bullets(doc, rows):
    for text in rows:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(text)
        set_font(r)


def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    table.autofit = False
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = header
        if widths:
            cell.width = Inches(widths[i])
        style_cell(cell, header=True)
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = value
            if widths:
                cells[i].width = Inches(widths[i])
            style_cell(cells[i])
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_code_block(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.18)
    p.paragraph_format.right_indent = Inches(0.18)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.05
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F3F6F8")
    p._p.get_or_add_pPr().append(shd)
    r = p.add_run(text)
    set_font(r, name="Consolas", size=8.5)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.7)
    section.bottom_margin = Inches(0.7)
    section.left_margin = Inches(0.72)
    section.right_margin = Inches(0.72)

    styles = doc.styles
    styles["Normal"].font.name = "Microsoft YaHei"
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    styles["Normal"].font.size = Pt(10.5)

    title = doc.add_paragraph(style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_after = Pt(7)
    r = title.add_run("Seedance 数字人互动视频技术要求")
    set_font(r, size=20, bold=True)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.paragraph_format.space_after = Pt(16)
    r = sub.add_run("适用对象  Seedance 2.5 图生视频生成任务")
    set_font(r, size=10.5, color=(80, 80, 80))

    add_body(doc, "本文件用于生成可供后续实时口型驱动使用的全身数字人动作素材。生成视频必须保持人物身份与服装一致，并让嘴唇在整段视频中保持自然闭合且不产生说话型变化。后续系统会单独替换口型，因此不得用任何整块下半脸覆盖或硬拼接方式处理嘴部。")

    add_heading(doc, "一 交付目标")
    add_table(doc,
              ["项目", "要求"],
              [
                  ["用途", "互动数字人状态机素材，可在待机 讲解 问候 指引 致谢等状态间切换"],
                  ["人物", "使用提供的职业女性全身参考图。须保持同一张脸、发型、深蓝色西装、白色内搭、项链、黑色鞋和整体比例"],
                  ["画幅", "竖屏 9 比 16；建议输出不低于 720 乘 1280。人物从头到脚完整可见，四周留出少量安全边距"],
                  ["时长与帧率", "每个独立动作 4 至 6 秒；建议 24 fps 或平台可选的稳定帧率"],
                  ["镜头", "固定正面全身机位；禁止推拉 摇移 跟拍 变焦 画面重构或切镜头"],
                  ["背景", "纯浅灰影棚背景、柔和均匀布光、无文字 无标志 无水印 无字幕"],
              ], [1.35, 5.55])

    add_heading(doc, "二 锁嘴硬性要求")
    add_body(doc, "以下约束优先级最高。生成时请将其写入主提示词和负面提示词；如果 Seedance 提供面部运动控制、区域约束或运动笔刷，嘴唇区域应设置为最低运动或固定状态。")
    add_bullets(doc, [
        "嘴唇从第一帧到最后一帧保持自然闭合；上下唇不得张开、分离、抖动、变形或做出发音口型。",
        "允许自然眨眼、轻微眼神变化、眉眼表情和正常呼吸；允许轻微头部稳定动作，但不得改变脸部身份。",
        "禁止说话、唱歌、默念、口型同步、咀嚼、舔嘴、露齿、夸张微笑导致的开口。",
        "禁止将鼻子以下整块区域冻结或贴片；禁止出现嘴部与鼻唇沟、脸颊、下巴之间的色差、边缘线、撕裂、双重纹理或拼贴感。",
        "如果模型无法同时满足闭嘴和自然表情，优先选择稳定自然闭嘴，降低表情幅度，而不是对下半脸做硬性遮罩。",
    ])

    add_heading(doc, "三 全局提示词")
    add_body(doc, "将以下英文文本与具体动作提示拼接后使用。人物参考图需作为图生视频的唯一人物身份参考。")
    add_code_block(doc, "Use the supplied reference image as the exact identity reference for the same professional female digital guide. Preserve her face, hairstyle, navy business suit, white blouse, pendant, body proportions, and black shoes. Fixed front-facing full-body camera, 9:16 portrait, neutral light-gray studio background, soft even lighting, feet fully visible, no camera movement, no cut. Natural breathing and occasional blinking only. Her lips stay naturally closed and completely motionless for the entire clip: no speech, no lip movement, no mouth opening, no teeth, no phoneme shapes, no singing. Keep the facial skin, philtrum, nasolabial folds, chin, and jaw continuous and natural with no face patch, mask edge, seam, collage, or lower-face freeze artifact. No text, logo, watermark, subtitles, audio, or music.")

    add_heading(doc, "四 负面提示词")
    add_code_block(doc, "talking, speaking, lip sync, moving lips, mouth opening, open mouth, teeth, singing, whispering, chewing, lip trembling, mouth deformation, facial seam, face patch, lower-face freeze, collage artifact, split face, texture mismatch, identity drift, face swap, camera movement, zoom, pan, cut, text, logo, watermark, subtitles")

    add_heading(doc, "五 动作规格和动作提示")
    add_table(doc,
              ["动作编号", "动作说明", "追加英文动作提示"],
              [
                  ["A01 待机", "站立平视，双手于下腹自然交叠，轻微呼吸和一次自然眨眼。起止姿态一致，便于循环。", "Start and end in the same attentive neutral standing pose. Hands gently interlaced at the lower abdomen. Only subtle breathing and one natural blink. No hand movement."],
                  ["A02 问候", "从待机开始，右手抬至肩部高度，做两次缓慢小幅度掌心朝前的挥手，回到待机。", "Start from the neutral pose. Raise the right hand to shoulder height and perform exactly two slow small open-palm greeting waves. Smoothly return the hand to the neutral pose."],
                  ["A03 平静讲解", "双手在腰胸之间做小幅开放式解释手势，动作克制，不超过肩宽，回到下腹。", "Perform restrained professional explanatory gestures between waist and chest height with softly open palms. Keep movements small and fluid, then return both hands to the lower-abdomen pose."],
                  ["A04 重点强调", "右手做一次小幅度强调动作，左手保持稳定；结束回到自然讲解姿态。", "Make one small measured right-hand emphasis gesture as if highlighting one key point. Keep the left hand stable. Return to a calm speaking-ready pose."],
                  ["A05 方向指引", "右臂斜向伸向观众左侧，掌心打开，保持短暂停顿后收回。肩部仍正对镜头。", "Gently extend the right arm diagonally toward viewer left with an open-palm presenting gesture. Keep shoulders facing forward. Hold briefly, then return to neutral."],
                  ["A06 致谢回应", "双手在下腹轻合，做一次极轻微点头，手掌微微打开，再回到聆听姿态。", "Bring both hands together lightly at the lower abdomen, make one subtle respectful nod, open the hands slightly in appreciation, then return to the attentive listening pose."],
                  ["A07 聆听", "手臂自然放松，表情专注，轻微点头或一次眨眼，整体安静稳定。", "Stand in a silent attentive listening pose with arms relaxed naturally. One small acknowledgement nod or one natural blink only. End balanced and still."],
              ], [1.0, 2.5, 3.4])

    add_heading(doc, "五之一 完整动作库")
    add_body(doc, "以下 36 条为完整状态机动作。N0 表示中性待机姿态，S0 表示讲话准备姿态。每次生成只选择一条动作提示，并与全局锁嘴提示词一同使用。参考图文件为 数字人参考图无水印.png。")
    full_actions = """A01|自然待机|N0→N0|安静站立，胸肩随呼吸轻微起伏，偶尔眨眼，双手基本安静；一个周期后回到相近的呼吸相位与重心。
A02|微笑待机|N0→N0|温和看向观众，笑意轻微加深后自然放松，配合呼吸和眨眼，身体不反复摇晃。
A03|调整重心|N0→N0|双脚不动，重心缓慢向一侧轻微调整，再回到均衡承重，保持头部和视线稳定。
A04|专注倾听|N0→N0|头部轻微前倾，目光集中于前方，嘴唇闭合，手臂安静，再缓慢回正，不连续点头。
A05|倾听回应|N0→N0|闭口轻轻点头一次，表示正在听，随后恢复原有头部角度，双手保持安静。
A06|短暂思考|N0→N0|视线短暂略向侧下方偏移，神情轻微思考，然后重新看向观众，不托腮、不夸张皱眉。
A07|耐心等待|N0→N0|平静友好地站立，只保留呼吸与眨眼，不看表、不催促、不重复做手势。
A08|挥手问候|N0→N0|右手自然抬至肩部附近，掌心向前，轻轻左右摆动两次，微笑后缓慢放下。
A09|展开双手欢迎|N0→N0|双手抬至腰前，掌心斜向上，适度向左右展开表示欢迎，稍停后自然落下。
A10|挥手送别|N0→N0|微笑抬起右手，柔和摆动两次，配合轻微点头，然后收回，不转身走出画面。
A11|致谢|N0→N0|微笑稍微加深，头部连同上身轻轻前倾致意，随后平稳直起，不深鞠躬。
A12|平静讲话|S0→S0|右手在腰前做一次小幅向前、向上的开放手势，左手轻微配合，再自然回到准备位置。
A13|自然讲解|S0→S0|右手先向前展开，左手随后做较小的辅助动作，表现层层说明，最后双手收回腰前。
A14|亲切交流|S0→S0|双手小幅打开，掌心略向上，身体轻微前倾，微笑交流后回正并收手。
A15|强调重点|S0→S0|右手抬至下胸部，以开放手掌做一次清晰、短促的强调动作，然后柔和减速并收回。
A16|兴奋讲解挥手|S0→S0|神情变得明亮，双手抬至胸前并展开，右手做一次有力量但受控的向外挥臂，随后逐渐收势。
A17|分步骤讲解|S0→S0|右手以开放手掌依次做三次间隔清楚的小幅推进，每次稍停，完成后收回，不强求手指数数。
A18|比较两个选项|S0→S0|先展示画面左侧，再展示画面右侧，两侧动作幅度接近，最后视线回正、双手收回。
A19|总结收束|S0→S0|双手稍向两侧展开，再平稳向中间靠近，配合轻微点头，表达归纳总结，两手不相碰。
A20|展示画面左侧|S0→S0|人物右手朝观众看到的左侧展开，掌心向上，视线短暂跟随，再看回观众并收手。
A21|展示画面右侧|S0→S0|人物左手朝观众看到的右侧展开，掌心向上，视线短暂跟随，再看回观众并收手。
A22|指示屏幕下方|S0→S0|以整个手掌向屏幕下方柔和示意，视线短暂向下，再回正并收手，不点按虚构物体。
A23|邀请对方提问|S0→N0|右手掌心朝上轻轻向前展开，头部略侧倾，随后双手放下，以闭口倾听姿势结束。
A24|温和确认|S0→S0|轻轻点头一次，右手配合小幅开放手势，然后回正，神情认真友好。
A25|请求澄清|S0→S0|眉部微抬，头部略侧倾，右手掌心向上小幅打开，表示礼貌询问，然后恢复。
A26|礼貌致歉|S0→S0|笑意适度收敛，头部轻轻前倾一次，随后抬头恢复温和认真的神情，不反复鞠躬。
A27|温和安抚|S0→S0|双手掌心略向下，做一次缓慢、小幅的下压手势，神情平和，然后回到腰前。
A28|温和纠正|S0→S0|轻微摇头一次，右手以开放掌心辅助解释，随后恢复，不摆食指、不表现训斥。
A29|欣喜认可|S0→S0|微笑加深，轻点头一次，双手稍向前打开表达积极回应，再恢复准备姿势。
A30|小幅庆祝|S0→S0|双手抬到胸口以下，短促向外展开并轻轻上提，随后缓慢回落，不跳跃、不持续欢呼。
A31|准备开口|N0→S0|双手从身体两侧沿自然弧线抬至腰前，逐渐减速，形成讲话准备姿势。
A32|停讲转倾听|S0→N0|神情转为专注，双手从腰前平稳落回身体两侧，闭口并准备听对方讲话。
A33|讲完放松|S0→N0|双手缓缓放低，肩部轻微放松，恢复温和表情，以自然呼吸状态结束。
A34|恢复讲解|N0→S0|保持视线连接，先轻微点头，再把双手抬回腰前，准备继续讲解，不重新打招呼。
A35|转交人工|S0→N0|右手向前礼貌示意，像在说明接下来由工作人员协助，然后双手放下并安静等待。
A36|等待确认交流对象|N0→N0|保持中性友好的站姿，闭口、自然呼吸，不左右追随、不点头确认，等待重新确定交流对象。"""
    add_table(doc, ["编号", "动作", "起止", "中文动作提示"], [line.split("|") for line in full_actions.splitlines()], [0.65, 1.25, 0.7, 4.3])

    add_heading(doc, "六 生成和验收流程")
    add_table(doc,
              ["步骤", "执行要求", "验收条件"],
              [
                  ["1 参考图", "只上传一张已确认的人物全身参考图；不混用其他人像或风格参考。", "首帧即可辨认为同一人物，服装和全身比例稳定。"],
                  ["2 单动作生成", "每次仅生成一个完整动作；首尾均回到可衔接姿态，避免复杂连续剧情。", "动作有清楚的开始 过程 结束，可被程序独立调用。"],
                  ["3 逐帧检查", "重点检查第 1 帧 中间帧和最后 1 帧；必要时逐帧检查唇部区域。", "嘴唇持续闭合；没有开口、口型或上下脸拼接边缘。"],
                  ["4 质量筛选", "淘汰任何身份漂移、手指数异常、镜头移动、背景改变或衣物闪烁的结果。", "全身完整可见，动作平滑，背景和灯光稳定。"],
                  ["5 文件命名", "采用 action 名称和版本号，例如 guide_greeting_wave_seedance_v1.mp4。", "可从文件名识别动作，避免覆盖已验收版本。"],
              ], [0.75, 3.3, 2.85])

    add_heading(doc, "七 不通过条件")
    add_bullets(doc, [
        "任意帧出现嘴唇张开、口型变化、露齿、疑似说话或唱歌。",
        "嘴部附近出现断层、矩形边缘、上下脸色差、下巴冻结、局部纹理与脸部不连续。",
        "人物脸、服装、发型、鞋子或身材比例明显漂移；手部畸形或肢体穿插。",
        "镜头移动、裁切掉脚部、背景变化、出现文字 标志 水印 字幕或音频。",
        "动作首尾无法自然衔接到待机或聆听状态。",
    ])

    add_heading(doc, "八 交付清单")
    add_body(doc, "每个动作交付一条无声 MP4 成片及一个可追溯的生成记录。生成记录至少包含：参考图版本、完整主提示词、负面提示词、Seedance 参数、时长、帧率、动作编号和人工验收结论。")

    doc.core_properties.title = "Seedance 数字人互动视频技术要求"
    doc.core_properties.subject = "锁嘴全身数字人图生视频生成规范"
    doc.core_properties.author = "DigitalGuide"
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
