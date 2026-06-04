# agent_meetting TODO

## ✅ 已完成

- [x] agents.py 改用 `openclaw agent --agent <id>` 调用真实 LLM Agent
- [x] orchestrator.py 支持多轮交叉讨论（Literature ↔ Paper ↔ Bio）
- [x] 最终意见汇总（Literature / Paper / Bio 各自总结）
- [x] 完整跑通一次：NF1基因突变在黑色素瘤中的作用机制
- [x] 文件结构：project.json / tasks / discussions / files / final_report
- [x] Main Agent 前置真实检索：PubMed / Europe PMC / CrossRef / GEO
- [x] 任务模板和会议参与规则配置化：`config/meeting_rules.json`
- [x] 新 Agent 可通过 `agents.json` + `meeting_rules.json` 扩展，无需重写 pipeline

## 待改进

### 1. 继续增强 paper-search MCP 工具
Main Agent 已经会做真实检索预取。下一步可以给 Literature Agent 自身配置 paper-search MCP 工具，让它在会议中按追问继续补充检索。

### 2. 含子讨论的文件名问题  
`discussion_literature_to_paper.md` 和占位文件名 `discussion_literature_to_paper_result.md` 同时出现。

### 3. final_report 缺少 final_paper_opinion 和 final_bio_opinion 的 sections
检查 orchestrator.py 中的文件匹配逻辑是否重复。

### 4. 支持更复杂会议协议
当前支持配置化发言规则。后续可增加多轮投票、冲突裁决、证据等级评分、主席总结模板。

### 5. 检索源稳定性
本地 Clash/HTTPS 环境可能导致 NCBI SSL EOF。已加入 Europe PMC 和 CrossRef 备用源；后续可加代理配置、NCBI API key、Semantic Scholar。
