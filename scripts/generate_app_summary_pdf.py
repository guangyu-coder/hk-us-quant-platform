from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.pdfmetrics import registerFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
EN_OUTPUT_PATH = OUTPUT_DIR / "hk-us-quant-platform-app-summary.pdf"
ZH_OUTPUT_PATH = OUTPUT_DIR / "hk-us-quant-platform-app-summary-zh.pdf"


def paragraph(text: str, style: ParagraphStyle):
    return Paragraph(text.replace("\n", "<br/>"), style)


def bullet_lines(items: list[str], style: ParagraphStyle):
    return [Paragraph(f"&bull; {item}", style) for item in items]


def build_styles(font_name: str, title_size: float, body_size: float, small_size: float, section_size: float):
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=body_size,
        leading=body_size + 2,
        textColor=colors.HexColor("#1f2937"),
        spaceAfter=0,
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=small_size,
        leading=small_size + 1.6,
    )
    section = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName=font_name,
        fontSize=section_size,
        leading=section_size + 1.8,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
        spaceBefore=0,
    )
    title = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontName=font_name,
        fontSize=title_size,
        leading=title_size + 2,
        textColor=colors.white,
        spaceAfter=2,
    )
    return body, small, section, title


def add_header(story: list, width: float, text: str, title_style: ParagraphStyle):
    header = Table([[paragraph(text, title_style)]], colWidths=[width])
    header.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0f4c81")),
                ("BOX", (0, 0), (-1, -1), 0, colors.HexColor("#0f4c81")),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(header)
    story.append(Spacer(1, 10))


def build_english_pdf() -> Path:
    body, small, section, title = build_styles(
        font_name="Helvetica",
        title_size=17,
        body_size=8.7,
        small_size=7.9,
        section_size=10.2,
    )
    story = []

    add_header(
        story,
        7.1 * inch,
        "<b>HK/US Quant Trading Platform</b><br/>"
        "<font size='8.4' color='#dbeafe'>"
        "One-page repo-backed summary generated from README, compose files, and backend/frontend entry points."
        "</font>",
        title,
    )

    left_top = [
        paragraph("<b>What It Is</b>", section),
        paragraph(
            "A full-stack quantitative trading platform prototype for Hong Kong and US markets. "
            "The repo combines a Rust backend, a Next.js dashboard, Postgres/TimescaleDB, Redis, and optional monitoring services.",
            body,
        ),
        Spacer(1, 5),
        paragraph("<b>Who It's For</b>", section),
        paragraph(
            "<b>Primary persona:</b> Not found in repo.<br/>"
            "<b>Repo evidence suggests:</b> a trader/quant operator using an internal dashboard to monitor market data, strategies, orders, portfolio, and risk.",
            body,
        ),
        Spacer(1, 5),
        paragraph("<b>What It Does</b>", section),
    ]
    left_top.extend(
        bullet_lines(
            [
                "Shows an operator dashboard with market, portfolio, trade, and system-status widgets.",
                "Provides market-data APIs for quote lookup, history, batch fetch, symbol search, and market listing.",
                "Supports strategy CRUD plus a backtest endpoint from the Rust API and strategies page.",
                "Supports order list/create/get/cancel, including limit, stop, and extended-hours fields.",
                "Exposes portfolio, positions, PnL, risk metrics, and risk-alert endpoints for the UI.",
                "Polls backend health and key datasets on intervals via TanStack Query in the frontend.",
                "Includes Dockerized infra for Postgres/TimescaleDB, Redis, app, Nginx, Prometheus, and Grafana.",
            ],
            body,
        )
    )

    right_top = [paragraph("<b>How It Works</b>", section)]
    right_top.extend(
        bullet_lines(
            [
                "<b>Frontend:</b> Next.js 14 app-router UI in <font face='Courier'>frontend/src/app</font> with Axios calls to relative <font face='Courier'>/api</font> paths.",
                "<b>Proxy:</b> <font face='Courier'>frontend/next.config.js</font> rewrites <font face='Courier'>/api/*</font> and <font face='Courier'>/health</font> to the Rust backend on port 8080.",
                "<b>Backend:</b> Axum server in <font face='Courier'>src/main.rs</font> loads config, runs SQL migrations, and creates shared data/strategy/execution/portfolio/risk services in <font face='Courier'>AppState</font>.",
                "<b>Data layer:</b> sqlx talks to Postgres; Redis backs the event bus; historical market data uses a Yahoo Finance client; symbol search/list shell out to <font face='Courier'>scripts/market_data.py</font>.",
                "<b>Ops stack:</b> <font face='Courier'>docker-compose.yml</font> provisions Timescale/Postgres, Redis, the app container, optional Nginx, Prometheus, and Grafana.",
                "<b>Gap called out by repo:</b> WebSocket code exists, but the README says <font face='Courier'>/ws</font> is not mounted in the main router by default.",
            ],
            small,
        )
    )

    left_table = Table([[left_top]], colWidths=[3.48 * inch])
    left_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    right_table = Table([[right_top]], colWidths=[3.38 * inch])
    right_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    top_grid = Table([[left_table, right_table]], colWidths=[3.56 * inch, 3.54 * inch])
    top_grid.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(top_grid)
    story.append(Spacer(1, 8))

    story.append(paragraph("<b>How To Run</b>", section))
    run_rows = [
        [paragraph("<b>1</b>", body), paragraph("Start core services: <font face='Courier'>docker compose up -d postgres redis</font>", body)],
        [paragraph("<b>2</b>", body), paragraph("Run the backend from repo root: <font face='Courier'>cargo run</font>", body)],
        [paragraph("<b>3</b>", body), paragraph("Run the frontend: <font face='Courier'>cd frontend</font>, <font face='Courier'>npm install</font>, then <font face='Courier'>npm run dev</font>", body)],
        [paragraph("<b>4</b>", body), paragraph("Open <font face='Courier'>http://localhost:3000</font>. Backend health is at <font face='Courier'>http://localhost:8080/health</font>.", body)],
    ]
    run_table = Table(run_rows, colWidths=[0.35 * inch, 6.75 * inch])
    run_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(run_table)
    story.append(Spacer(1, 7))
    story.append(
        paragraph(
            "<font color='#6b7280'>Source basis: README.md, docker-compose.yml, .env.example, Cargo.toml, frontend/package.json, "
            "frontend/next.config.js, src/main.rs, frontend/src/lib/api.ts, and referenced UI pages/components.</font>",
            small,
        )
    )

    doc = SimpleDocTemplate(
        str(EN_OUTPUT_PATH),
        pagesize=letter,
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.42 * inch,
        bottomMargin=0.35 * inch,
        title="HK/US Quant Trading Platform Summary",
        author="Codex",
    )
    doc.build(story)
    return EN_OUTPUT_PATH


def build_chinese_pdf() -> Path:
    registerFont(UnicodeCIDFont("STSong-Light"))
    body, small, section, title = build_styles(
        font_name="STSong-Light",
        title_size=16.2,
        body_size=8.8,
        small_size=7.8,
        section_size=10.2,
    )
    story = []

    add_header(
        story,
        7.1 * inch,
        "<b>港美股量化交易平台</b><br/>"
        "<font size='8.0' color='#dbeafe'>"
        "基于 README、compose 文件以及前后端入口代码整理的一页版仓库摘要。"
        "</font>",
        title,
    )

    left_top = [
        paragraph("<b>它是什么</b>", section),
        paragraph(
            "一个面向港股和美股场景的全栈量化交易平台原型。仓库内同时包含 Rust 后端、Next.js 仪表盘、Postgres/TimescaleDB、Redis，以及可选监控组件。",
            body,
        ),
        Spacer(1, 4),
        paragraph("<b>适合谁</b>", section),
        paragraph(
            "<b>主要用户画像：</b>仓库中未明确说明。<br/>"
            "<b>从仓库证据推断：</b>更像是给内部交易员或量化运营人员使用，用于查看行情、策略、订单、组合和风控状态。",
            body,
        ),
        Spacer(1, 4),
        paragraph("<b>它能做什么</b>", section),
    ]
    left_top.extend(
        bullet_lines(
            [
                "提供仪表盘首页，聚合市场、组合、交易和系统状态部件。",
                "提供行情接口，支持单标的报价、历史数据、批量查询、代码搜索和市场列表。",
                "支持策略列表、新建、更新、删除，以及从策略页触发回测。",
                "支持订单列表、创建、查询、取消，并包含限价、止损和盘前盘后字段。",
                "提供投资组合、持仓、盈亏、风险指标和风险告警接口给前端调用。",
                "前端通过 TanStack Query 定时轮询健康状态和核心数据。",
                "仓库自带基于 Docker Compose 的 Postgres/TimescaleDB、Redis、应用和监控栈。",
            ],
            body,
        )
    )

    right_top = [paragraph("<b>它如何工作</b>", section)]
    right_top.extend(
        bullet_lines(
            [
                "<b>前端：</b><font face='Courier'>frontend/src/app</font> 下是 Next.js 14 App Router 页面；数据请求走相对路径 <font face='Courier'>/api</font>。",
                "<b>代理：</b><font face='Courier'>frontend/next.config.js</font> 把 <font face='Courier'>/api/*</font> 与 <font face='Courier'>/health</font> 转发到 8080 端口的 Rust 后端。",
                "<b>后端：</b><font face='Courier'>src/main.rs</font> 启动 Axum，加载配置，执行 SQL 迁移，并把数据、策略、执行、组合、风控服务放进共享 <font face='Courier'>AppState</font>。",
                "<b>数据层：</b>sqlx 连接 Postgres，Redis 承担事件总线；历史行情走 Yahoo Finance 客户端；代码搜索和市场列表通过 <font face='Courier'>scripts/market_data.py</font> 执行。",
                "<b>运维层：</b><font face='Courier'>docker-compose.yml</font> 负责 Timescale/Postgres、Redis、应用容器，以及可选的 Nginx、Prometheus、Grafana。",
                "<b>仓库已知缺口：</b>存在 WebSocket 代码，但 README 明确写到默认路由下 <font face='Courier'>/ws</font> 尚未挂载。",
            ],
            small,
        )
    )

    left_table = Table([[left_top]], colWidths=[3.48 * inch])
    left_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    right_table = Table([[right_top]], colWidths=[3.38 * inch])
    right_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    top_grid = Table([[left_table, right_table]], colWidths=[3.56 * inch, 3.54 * inch])
    top_grid.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(top_grid)
    story.append(Spacer(1, 7))

    story.append(paragraph("<b>如何运行</b>", section))
    run_rows = [
        [paragraph("<b>1</b>", body), paragraph("启动基础服务：<font face='Courier'>docker compose up -d postgres redis</font>", body)],
        [paragraph("<b>2</b>", body), paragraph("在仓库根目录启动后端：<font face='Courier'>cargo run</font>", body)],
        [paragraph("<b>3</b>", body), paragraph("启动前端：<font face='Courier'>cd frontend</font>、<font face='Courier'>npm install</font>、<font face='Courier'>npm run dev</font>", body)],
        [paragraph("<b>4</b>", body), paragraph("访问 <font face='Courier'>http://localhost:3000</font>，后端健康检查地址是 <font face='Courier'>http://localhost:8080/health</font>。", body)],
    ]
    run_table = Table(run_rows, colWidths=[0.35 * inch, 6.75 * inch])
    run_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(run_table)
    story.append(Spacer(1, 6))
    story.append(
        paragraph(
            "<font color='#6b7280'>内容依据：README.md、docker-compose.yml、.env.example、Cargo.toml、frontend/package.json、"
            "frontend/next.config.js、src/main.rs、frontend/src/lib/api.ts 以及对应页面/组件代码。</font>",
            small,
        )
    )

    doc = SimpleDocTemplate(
        str(ZH_OUTPUT_PATH),
        pagesize=letter,
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.42 * inch,
        bottomMargin=0.35 * inch,
        title="港美股量化交易平台摘要",
        author="Codex",
    )
    doc.build(story)
    return ZH_OUTPUT_PATH


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    english = build_english_pdf()
    chinese = build_chinese_pdf()
    print(english)
    print(chinese)


if __name__ == "__main__":
    main()
