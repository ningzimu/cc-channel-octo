# Plan: 修复冷 roster / 新子区首条 @ 灰字(mention 显名边界)

## 背景
已合的 #178+#88 让**热 thread** 的 @人/@bot 正常显名。但仍有灰字边界(截图实证):
1. **模型格式错**:即便 #178 prompt 写了"禁字面 uid",模型(实测 cc 自己)仍会把 `@[<uid>:<displayName>]` 里的 `<uid>` **塌缩成字面单词 `uid`** 去填、真 uid 塞进名字槽 → 解析出无效 uid → entity 被丢 → 灰字。抽象占位符把模型带偏。
2. **冷 roster**:outbound `resolveMentions`(stream-relay.ts:223)用 `isValidUid = isMember(channelId, uid)`(index.ts:982)做 A8(#143)防幻觉校验。某 channel 的 roster 没热(uid 不在成员快照)→ **即便结构化格式正确,entity 也被过滤掉** → 降级成灰字 `@名字`。正常回复路径入站已 `refreshMembers`(index.ts:484)预热,所以边界只出在**新建子区首条 / 旁路发送**(命令/进度/直接 sendMessage)这类不走回复预热的路径。

范围:只 cc-channel-octo。不碰 OpenClaw。不放松 A8 成员守卫(防幻觉 uid 仍要拦)。

## 修复(两头,缺一都留灰字)

### Part A — prompt(agent-bridge.ts)
把抽象 `<uid>` 占位符换成**具体 worked example**,让模型无法塌缩成字面 "uid":
- 明确"看到发送者前缀 `名字(uid)`,例如 `caster(d71255…)`,就写 `@[d71255…:caster]` —— **真 uid 在前、显示名在后**";
- 保留"绝不产出字面单词 uid"。
- 纯文案。

### Part B — 冷 roster 兜底(代码,不放松 A8)
outbound 解析 mention 前,若目标 channel 的 roster 冷(memberMap 空/未含被 @ 的 uid),**先同步预热再解析**:
- **主修**:发送前对该 channelId 若 memberMap 为空则 `await refreshMembers(channelId)`(节流已存在,热则近乎 no-op),覆盖"新子区首条 / 旁路发送"路径;
- **兜底(可选)**:结构化 mention 的 uid 过 A8 校验失败时,按该 uid 先 `fetchAndLearnUser`/refresh 回填一次,再决定是否保留 entity —— A8 守卫不放松,只是"先补数据再判"。
- 具体接入点:stream-relay 的 `deliver()` 前置,或 index.ts 组装 isValidUid 前确保预热。②plan review 时定主修落点。

## 测试
- 冷 roster + 结构化 `@[真uid:名字]`:预热后 entity 保留、不降级灰字。
- 新 thread 首条 outbound @:显名(集成)。
- A8 防幻觉不回归:非成员的幻觉 uid 仍被拦(补热后仍不在成员表 → 照旧丢)。
- Part A 格式:文案含具体范例(无法自动测模型行为,靠范例约束 + 人核)。

## Rollout
Qcodex + Qopenclaw 审 plan(②)、审代码(④)→ 本地部署验证(新建子区首条 @ 显名)→ caster 测过 → 合一个 PR。#178 已合,本轮独立。

## 待定(②review 定)
- Part B 主修落点(stream-relay 前置 vs index 预热),以及"每条 outbound 都查空 memberMap"会不会加延迟(热则 refreshMembers 节流跳过,应可忽略;需确认)。
- Part B 的"on-miss 回填"要不要一并做,还是先只做预热(主修)。
