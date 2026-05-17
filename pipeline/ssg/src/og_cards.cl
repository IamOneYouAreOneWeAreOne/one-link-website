// =============================================================================
// CEL SSG — Open Graph Image Generator
// =============================================================================
//
// Generates OG social preview cards using std.graphics and std.media.image.
// The current backend emits SVG assets in dist/og/ for each page with:
// - Deep-space glassmorphism background
// - Title text with gradient glow
// - Brand + domain identifier
// - Node type badge
//
// NO external image libraries. ALL rendering via .cl stdlib.
// =============================================================================

module cel.ssg.og_cards;

import std.graphics as gfx;
import std.graphics.color as color;
import std.graphics.canvas as canvas;
import std.media.image as img;
import std.io.fs as fs;
import std.io.fs.path as path;
import std.core.option as opt;
import std.core.primitives as prim;
import cel.ssg.build as build;

// =============================================================================
// CONSTANTS
// =============================================================================

const WIDTH: Int = 1200;
const HEIGHT: Int = 630;

// Deep-space color palette
const BG_TOP: color.Color = color.from_hex("#0a0a1a");
const BG_BOTTOM: color.Color = color.from_hex("#0f0f2e");
const ACCENT_BLUE: color.Color = color.from_hex("#4facfe");
const ACCENT_PURPLE: color.Color = color.from_hex("#7c3aed");
const ACCENT_GOLD: color.Color = color.from_hex("#f5a623");
const TEXT_WHITE: color.Color = color.from_hex("#f0f0ff");
const TEXT_DIM: color.Color = color.from_hex("#9090b0");

// Spiritual theme
const SPIRIT_BG_TOP: color.Color = color.from_hex("#faf9f6");
const SPIRIT_BG_BOTTOM: color.Color = color.from_hex("#f0ede6");
const SPIRIT_TEXT: color.Color = color.from_hex("#1a1a2e");
const SPIRIT_ACCENT: color.Color = color.from_hex("#8b7355");

// =============================================================================
// PUBLIC API
// =============================================================================

pub fn generate_all(out_dir: String, domain: String, sw: build.SiteWorld) -> Int
    effects [ExternalIO]
{
    fs.create_dir_all(out_dir);

    let is_cel = domain == "coherenceenergylabs.com";
    let mut count = 0;

    // Home page OG
    generate_card(
        out_dir + "/home.svg",
        if is_cel { "Coherence Energy Labs" } else { "OneUnity" },
        if is_cel { "The website is the proof." } else { "One field. One truth. One unity." },
        "Home",
        is_cel,
    );
    count = count + 1;

    if is_cel {
        // Index pages
        let index_pages = [
            ("products", "Products", "Four product lines. Zero dependencies."),
            ("research", "Research", "Unified field theory across 7 domains."),
            ("demos", "Demos", "Interactive demonstrations. Zero JavaScript."),
            ("developers", "Developers", "Build with Coherence Lang."),
            ("about", "About", "One researcher. One compiler. One field theory."),
            ("atlas", "Atlas", "Navigate the connected SiteWorld graph."),
        ];
        for (slug, title, subtitle) in index_pages {
            generate_card(out_dir + "/" + slug + ".svg", title, subtitle, "Page", prim.Bool.True);
            count = count + 1;
        }

        // Detail pages
        for (_, node) in sw.nodes.iter() {
            let nd = node.domain.clone().unwrap_or("coherenceenergylabs.com");
            if nd != "oneunity.earth" {
                let ntype = node.node_type.clone();
                let label = match ntype.as_str() {
                    "Product" => "Product",
                    "Research" => node.domain.clone().unwrap_or("Research"),
                    "Demo" => node.subtype.clone().unwrap_or("Demo"),
                    _ => "Page",
                };
                generate_card(
                    out_dir + "/" + node.node_id + ".svg",
                    node.title,
                    label,
                    ntype,
                    prim.Bool.True,
                );
                count = count + 1;
            }
        }
    }

    count
}

// =============================================================================
// CARD RENDERER
// =============================================================================

fn generate_card(
    filepath: String,
    title: String,
    subtitle: String,
    badge: String,
    is_engineering: prim.Bool,
) effects [ExternalIO] {
    let mut c = canvas.Canvas.new(WIDTH, HEIGHT);

    if is_engineering {
        // Deep-space gradient background
        c = draw_gradient(c, BG_TOP, BG_BOTTOM);

        // Subtle grid pattern
        c = draw_grid(c, color.from_rgba(255, 255, 255, 8), 40);

        // Orbital glow ellipse (top-right)
        c = draw_glow_ellipse(c, 900, 150, 300, 200, ACCENT_BLUE, 30);

        // Secondary glow (bottom-left)
        c = draw_glow_ellipse(c, 200, 500, 250, 150, ACCENT_PURPLE, 20);

        // Badge
        c = draw_badge(c, badge, ACCENT_BLUE, 80, 60);

        // Title
        c = draw_text_large(c, title, TEXT_WHITE, 80, 140, 1040);

        // Subtitle
        c = draw_text_medium(c, subtitle, TEXT_DIM, 80, 340);

        // Bottom brand line
        c = draw_text_small(c, "coherenceenergylabs.com", TEXT_DIM, 80, 560);

        // Accent line
        c = draw_rect(c, 80, 520, 200, 3, ACCENT_BLUE);
    } else {
        // Spiritual theme — light, warm
        c = draw_gradient(c, SPIRIT_BG_TOP, SPIRIT_BG_BOTTOM);

        // Subtle golden accent circle
        c = draw_glow_ellipse(c, 600, 315, 400, 400, SPIRIT_ACCENT, 15);

        // Badge
        c = draw_badge(c, badge, SPIRIT_ACCENT, 80, 60);

        // Title
        c = draw_text_large(c, title, SPIRIT_TEXT, 80, 140, 1040);

        // Subtitle
        c = draw_text_medium(c, subtitle, color.from_hex("#5a5a70"), 80, 340);

        // Bottom brand
        c = draw_text_small(c, "oneunity.earth", color.from_hex("#8b7355"), 80, 560);

        // Accent line
        c = draw_rect(c, 80, 520, 200, 3, SPIRIT_ACCENT);
    }

    // Encode and write
    let png_data = img.encode_png(c.to_image());
    let parent = path.Path.new(filepath).parent();
    fs.create_dir_all(parent.as_str());
    fs.write_bytes(filepath, png_data);
}

// =============================================================================
// DRAWING PRIMITIVES
// =============================================================================

fn draw_gradient(c: canvas.Canvas, top: color.Color, bottom: color.Color) -> canvas.Canvas @ L0 {
    for y in 0..HEIGHT {
        let t = y as f64 / HEIGHT as f64;
        let row_color = color.lerp(top, bottom, t);
        c = c.draw_rect(0, y, WIDTH, 1, row_color);
    }
    c
}

fn draw_grid(c: canvas.Canvas, col: color.Color, spacing: Int) -> canvas.Canvas @ L0 {
    let mut y = 0;
    while y < HEIGHT {
        c = c.draw_rect(0, y, WIDTH, 1, col);
        y = y + spacing;
    }
    let mut x = 0;
    while x < WIDTH {
        c = c.draw_rect(x, 0, 1, HEIGHT, col);
        x = x + spacing;
    }
    c
}

fn draw_glow_ellipse(
    c: canvas.Canvas, cx: Int, cy: Int, rx: Int, ry: Int,
    col: color.Color, max_alpha: Int,
) -> canvas.Canvas @ L0 {
    // Approximate radial gradient with concentric ellipses
    let steps = 20;
    for i in 0..steps {
        let t = i as f64 / steps as f64;
        let alpha = ((1.0 - t) * max_alpha as f64) as Int;
        let srx = (rx as f64 * (1.0 - t * 0.8)) as Int;
        let sry = (ry as f64 * (1.0 - t * 0.8)) as Int;
        let fill = color.with_alpha(col, alpha);
        c = c.draw_ellipse(cx - srx, cy - sry, srx * 2, sry * 2, fill);
    }
    c
}

fn draw_badge(c: canvas.Canvas, text: String, col: color.Color, x: Int, y: Int) -> canvas.Canvas @ L0 {
    let w = text.len() * 10 + 24;
    c = c.draw_rounded_rect(x, y, w, 28, 4, color.with_alpha(col, 40));
    c = c.draw_text(text.to_uppercase(), x + 12, y + 6, 14, col);
    c
}

fn draw_text_large(c: canvas.Canvas, text: String, col: color.Color, x: Int, y: Int, max_w: Int) -> canvas.Canvas @ L0 {
    // Word-wrap for long titles
    let char_width = 28;  // approximate at font size 48
    let max_chars = max_w / char_width;

    if text.len() <= max_chars {
        c = c.draw_text(text, x, y, 48, col);
    } else {
        // Split into lines
        let words = text.split(" ");
        let mut line = "";
        let mut line_y = y;
        for word in words {
            let test = if line.len() == 0 { word.clone() } else { line + " " + word };
            if test.len() > max_chars && line.len() > 0 {
                c = c.draw_text(line, x, line_y, 48, col);
                line_y = line_y + 60;
                line = word;
            } else {
                line = test;
            }
        }
        if line.len() > 0 {
            c = c.draw_text(line, x, line_y, 48, col);
        }
    }
    c
}

fn draw_text_medium(c: canvas.Canvas, text: String, col: color.Color, x: Int, y: Int) -> canvas.Canvas @ L0 {
    c.draw_text(text, x, y, 24, col)
}

fn draw_text_small(c: canvas.Canvas, text: String, col: color.Color, x: Int, y: Int) -> canvas.Canvas @ L0 {
    c.draw_text(text, x, y, 16, col)
}

fn draw_rect(c: canvas.Canvas, x: Int, y: Int, w: Int, h: Int, col: color.Color) -> canvas.Canvas @ L0 {
    c.draw_rect(x, y, w, h, col)
}
