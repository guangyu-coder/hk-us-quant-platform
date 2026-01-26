---
name: frontend_design
description: Guidelines and best practices for creating modern, premium-quality web interfaces.
---

# Frontend Design & Development Skill

This skill outlines the standards for building web applications that are visually stunning, responsive, and provide a premium user experience.

## 1. Design Aesthetics (The "WOW" Factor)
- **Visual Excellence**: Do not settle for "basic". Use curated color palettes (e.g., tailored HSL), subtle gradients, and glassmorphism where appropriate.
- **Typography**: Use modern sans-serif fonts (Inter, Roboto, Outfit). Ensure proper hierarchy.
- **Micro-interactions**: Information should feel "alive". Use hover effects, smooth transitions, and subtle animations to provide feedback.
- **No Placeholders**: Never use placeholder text like "Lorem Ipsum" or gray boxes. Generate realistic content or use the `generate_image` tool for assets.

## 2. Technology Stack
- **Structure**: Semantic HTML5.
- **Styling**: 
  - **Preferred**: Vanilla CSS with CSS Variables for theming.
  - **Tailwind**: Only if explicitly requested by the user. verify version first.
- **Scripting**: Modern JavaScript (ES6+).
- **Frameworks**: Next.js or Vite (React/Vue) only when building complex applications or requested.

## 3. Implementation Workflow
1.  **Foundation**: Define design tokens (colors, spacing, typography) in `index.css` or a root variable file first.
2.  **Components**: Build reusable, self-contained components that strictly adhere to the design tokens.
3.  **Layout**: Assemble pages using responsive layouts (Flexbox/Grid). Mobile-first approach is recommended.
4.  **Polish**: Review margins, padding, and interactions. Ensure accessibility (checked against WCAG standards).

## 4. Coding Standards
- **CSS Naming**: Use BEM (Block Element Modifier) or a clear, semantic naming convention if not using utility classes.
- **Clean Code**: Keep components small and focused.
- **Performance**: Optimize images (WebP), lazy load assets, and minimize bundle sizes.

## 5. SEO & Accessibility
- **Meta**: Proper Title and Description tags.
- **Semantic**: Use `<main>`, `<nav>`, `<article>`, `<header>`, `<footer>` appropriately.
- **Alt Text**: All images must have descriptive alt text.
