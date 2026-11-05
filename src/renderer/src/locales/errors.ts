/**
 * 主进程错误的英文映射。
 *
 * 主进程只返回稳定的中文提示或错误码；渲染层展示前按当前语言转换，
 * 未命中的内容原样保留，避免吞掉路径、退出码等诊断信息。
 */
import i18n from '../i18n'

type Rule = [RegExp, string | ((match: RegExpMatchArray) => string)]

const RULES: Rule[] = [
  [/系统密钥环不可用，无法解密 MCP 凭据/, 'The system keychain is unavailable; MCP credentials cannot be decrypted.'],
  [/非法文件路径：(.+)/, (m) => `Invalid file path: ${m[1]}`],
  [/不允许绝对路径：(.+)/, (m) => `Absolute paths are not allowed: ${m[1]}`],
  [/路径越界：(.+)/, (m) => `Path escapes the skill root: ${m[1]}`],
  [/SKILL\.md 缺少 frontmatter/, 'SKILL.md is missing frontmatter.'],
  [/SKILL\.md 缺少 name/, 'SKILL.md is missing a name.'],
  [/SKILL\.md 缺少 description/, 'SKILL.md is missing a description.'],
  [/Skill 名称必须为小写字母、数字、连字符或下划线/, 'Skill names may contain only lowercase letters, digits, hyphens, or underscores.'],
  [/Skill 不能包含符号链接：(.+)/, (m) => `Skills cannot contain symlinks: ${m[1]}`],
  [/文件过大：(.+)/, (m) => `File is too large: ${m[1]}`],
  [/Skill 总大小超过限制/, 'The skill exceeds the total size limit.'],
  [/Skill 文件数量超过限制/, 'The skill exceeds the file count limit.'],
  [/没有找到 SKILL\.md/, 'No SKILL.md was found.'],
  [/缺少 Skill 目录路径/, 'The skill folder path is missing.'],
  [/缺少 ZIP 路径/, 'The ZIP path is missing.'],
  [/ZIP 文件超过大小限制/, 'The ZIP file exceeds the size limit.'],
  [/ZIP 总大小超过限制/, 'The ZIP exceeds the total size limit.'],
  [/ZIP 文件数量超过限制/, 'The ZIP exceeds the file count limit.'],
  [/缺少 Git 仓库地址/, 'The Git repository URL is missing.'],
  [/Git 地址只支持 http\(s\)、ssh、file 或本地路径/, 'Git sources support only http(s), ssh, file, or local paths.'],
  [/Git 克隆失败：(.+)/, (m) => `Git clone failed: ${m[1]}`],
  [/无法生成不冲突的 Skill 名称/, 'Unable to generate a non-conflicting skill name.'],
  [/Skill 内容不存在：(.+)/, (m) => `Skill content is missing: ${m[1]}`],
  [/SKILL_MATERIALIZATION_FAILED: (.+)/, (m) => `Failed to materialize the skill: ${m[1]}`],
  [/stdio MCP 缺少启动命令/, 'The stdio MCP server needs a launch command.'],
  [/^(.+) MCP 缺少 URL$/, (m) => `${m[1]} MCP needs a URL.`],
  [/stdio 传输需要启动命令/, 'The stdio transport needs a launch command.'],
  [/^(.+) 传输需要 URL$/, (m) => `${m[1]} transport needs a URL.`],
  [/MCP URL 格式无效/, 'The MCP URL format is invalid.'],
  [/MCP URL 必须是 http\(s\)/, 'The MCP URL must use http(s).'],
  [/MCP 服务已停用/, 'The MCP server is disabled.'],
  [/MCP 连接 超时/, 'MCP connection timed out.'],
  [/MCP 工具发现 超时/, 'MCP tool discovery timed out.'],
  [/未配置 ACP 启动命令/, 'No ACP launch command is configured.'],
  [/ACP session\/new 未返回 sessionId/, 'ACP session/new did not return a sessionId.'],
  [/ACP 进程退出（(.+)）：(.*)/, (m) => `ACP process exited (${m[1]}): ${m[2]}`],
  [/ACP 进程未运行/, 'The ACP process is not running.'],
  [/ACP 请求超时：(.+)/, (m) => `ACP request timed out: ${m[1]}`],
  [/ACP 请求失败/, 'The ACP request failed.'],
  [/未配置 Codex 启动命令/, 'No Codex launch command is configured.'],
  [/未配置 DSH 启动命令/, 'No DSH launch command is configured.'],
  [/Codex thread\/start 未返回线程 ID/, 'Codex thread/start did not return a thread ID.'],
  [/Codex app-server 已退出/, 'The Codex app-server exited.'],
  [/Codex 测试消息超时/, 'The Codex test message timed out.'],
  [/Codex 返回错误/, 'Codex returned an error.'],
  [/Pi 返回错误/, 'Pi returned an error.'],
  [/Pi 结束了本轮但返回错误/, 'Pi ended the turn with an error.'],
  [/Pi 结束了运行但返回错误/, 'Pi ended the run with an error.'],
  [/Pi 自动重试已耗尽/, 'Pi exhausted its automatic retries.'],
  [/会话队列已满（上限 (\d+)）/, (m) => `The session queue is full (limit ${m[1]}).`],
  [/排队任务已取消/, 'The queued task was cancelled.'],
  [/运行已取消/, 'The run was cancelled.'],
  [/运行时调度器已关闭/, 'The runtime scheduler is shut down.'],
  [/未注册的运行时协议族：(.+)/, (m) => `The "${m[1]}" runtime protocol family is not registered.`],
  [/运行时请求超时：(.+)/, (m) => `Runtime request timed out: ${m[1]}`],
  [/运行时进程退出（(.+)）：(.*)/, (m) => `Runtime process exited (${m[1]}): ${m[2]}`],
  [/运行时进程未运行/, 'The runtime process is not running.'],
  [/PIZZA_DATA_DIR 正在覆盖数据目录，无法在此切换/, 'PIZZA_DATA_DIR overrides the data directory, so it cannot be switched here.'],
  [/新目录与当前目录相同/, 'The new folder is the same as the current folder.'],
  [/新目录不能与当前目录互相包含/, 'The new folder cannot contain or be contained by the current folder.'],
  [/原数据目录不存在：(.+)/, (m) => `The original data folder does not exist: ${m[1]}`],
  [/切换数据目录失败，继续使用原目录。(.+)/, (m) => `Failed to switch the data folder; continuing with the original one. ${m[1]}`],
  [/不是目录：(.+)/, (m) => `Not a folder: ${m[1]}`],
  [/数据库完整性检查失败：(.+)/, (m) => `Database integrity check failed: ${m[1]}`],
  [/名称必须为小写字母、数字、连字符或下划线/, 'Names may contain only lowercase letters, digits, hyphens, or underscores.'],
  [/绑定的 Skill 不存在/, 'The bound skill no longer exists.'],
  [/Skill 内容目录缺失，已跳过注入/, 'The skill content folder is missing; injection was skipped.'],
  [/绑定的 MCP 服务不存在/, 'The bound MCP server no longer exists.'],
  [/该 ACP 运行时未声明远程 MCP 支持，已跳过 SSE\/HTTP 服务/, 'This ACP runtime does not declare remote MCP support; SSE/HTTP servers were skipped.'],
  [/团队成员覆盖引用的 MCP 服务不存在/, 'A team-member override references a missing MCP server.'],
  [/运行时本地配置的远程 MCP 未被 ACP 支持，已跳过/, 'The ACP runtime does not support remote MCP from local runtime config; it was skipped.'],
  [/未配置启动命令/, 'No launch command is configured.'],
  [/无法启动 (.+)：([\s\S]*)/, (m) => `Unable to launch ${m[1]}: ${m[2]}`],
  [/测试消息没有返回有效 JSON/, 'The test message did not return valid JSON.'],
  [/测试消息失败/, 'The test message failed.'],
  [/Claude Code 返回错误/, 'Claude Code returned an error.'],
  [/进程退出码 (.+)/, (m) => `Process exited with code ${m[1]}`],
  [/测试超时/, 'The test timed out.'],
  [/测试被取消/, 'The test was cancelled.'],
  [/用户停止了运行/, 'The user stopped the run.'],
  [/运行超时/, 'The run timed out.'],
  [/运行失败：([\s\S]*)/, (m) => `Run failed: ${m[1]}`],
  [/指挥者没有产生可保存的收敛文本/, 'The leader did not produce convergence text to save.'],
  [/^(.+) 提到了你$/, (m) => `${m[1]} mentioned you`],
  [/有智能体提到了你/, 'An agent mentioned you'],
  [/团队回合失败：(.+)。已完成内容已保留，可重试或继续补充。/, (m) => `Team turn failed: ${m[1]}. Completed work was kept; retry or continue.`],
  [/成员 (.+) 的运行被用户停止。/, (m) => `Member ${m[1]} was stopped by the user.`],
]

export function localizeError(message: string): string {
  if (i18n.language !== 'en') return message
  for (const [pattern, replacement] of RULES) {
    const match = message.match(pattern)
    if (!match) continue
    return typeof replacement === 'string' ? replacement : replacement(match)
  }
  return message
}
