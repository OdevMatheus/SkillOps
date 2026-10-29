# VHS Terminal Demo Recording Configuration for SkillOps
# Generate GIF via: vhs docs/assets/demo.tape

Output docs/assets/skillops-demo.gif

Set FontSize 16
Set Width 1100
Set Height 560
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20

Type "# 1. Audit Hybrid Executable Skill Catalog (Zero-API Token & Collision Gate)"
Enter
Sleep 400ms
Type "skillops audit --catalog catalog --strict"
Enter
Sleep 2500ms

Type "# 2. Transpile & Sync Optimal Skill Bundle Across AI Harnesses"
Enter
Sleep 400ms
Type "skillops sync --targets claude,antigravity,cursor,codex,copilot --dry-run"
Enter
Sleep 2500ms
