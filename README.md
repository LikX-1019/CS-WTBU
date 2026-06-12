# 课程表微信小程序

这是一个基于微信云开发的课程表小程序，当前已适配武汉工商学院教学管理信息系统：

```text
https://jxgl.wtbu.edu.cn/eams/home.action
```

## 项目结构

```text
miniprogram/                 小程序前端
cloudfunctions/getSchedule/  获取教务系统课表的云函数
project.config.json          微信开发者工具项目配置
```

`project.private.config.json` 是微信开发者工具生成的本机配置，不纳入版本库。

## 使用步骤

1. 用微信开发者工具导入本目录。
2. 在 `project.config.json` 中把 `appid` 改成你自己的小程序 AppID。
3. 开通云开发，并创建云环境。
4. 在 `miniprogram/app.js` 中确认或替换 `wx.cloud.init` 的 `env` 为你的云环境 ID。
5. 在云开发数据库中创建集合 `eduAccountBindings` 和 `feedbackItems`。
6. 给云函数 `getSchedule` 配置环境变量：
   - `EDU_PASSWORD_SECRET`：建议使用 32 字节随机 hex 字符串。
   - `ADMIN_OPENIDS`：管理员微信 OpenID 列表，多个 OpenID 可用英文逗号分隔。
7. 在微信开发者工具中右键 `cloudfunctions/getSchedule`，选择“安装依赖”；仓库内的 `package-lock.json` 用于锁定云函数依赖版本。
8. 右键 `cloudfunctions/getSchedule`，选择“上传并部署：云端安装依赖”。
9. 在模拟器中打开小程序，首次进入会跳转到绑定页，输入教务系统学号和密码绑定。

生成 `EDU_PASSWORD_SECRET` 的示例命令：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 安全建议

- 不要在小程序端保存教务系统密码。
- 为了每次打开自动刷新课表，云函数会把教务密码加密后保存到云数据库。
- `EDU_PASSWORD_SECRET` 必须妥善保存，后续更换密钥会导致已绑定账号需要重新绑定。
- `ADMIN_OPENIDS` 只在云函数端校验；管理员入口会出现在“个人”页，未加入名单的用户无法读取后台数据。
- 数据库集合建议只通过云函数读写，不要让小程序端直接读取绑定集合。
- 部署前请确认云函数环境变量已配置完成，且 `project.private.config.json` 等本机配置没有提交到版本库。
- 当前云函数使用 `wx-server-sdk@3.0.4`。`npm audit` 仍会报告微信云 SDK 内部传递依赖风险，升级前请先在云开发环境验证兼容性。

## 当前状态

已完成：

- 微信用户身份识别
- 教务账号绑定页
- 绑定页学校选择与搜索
- 小程序课表展示页
- 管理员后台概览、用户列表和反馈处理
- 意见反馈云端提交与本机最近记录
- 云函数 `getSchedule`
- 云数据库绑定记录
- AES-256-GCM 加密保存教务密码
- 打开小程序自动获取绑定账号课表
- 教务系统动态盐值 SHA1 登录
- 学生课表参数自动提取
- EAMS `TaskActivity` 课表脚本解析

本地已使用测试账号验证，能返回 `2025-2026学年第二学期` 的课表数据。

## 注意事项

学校教务系统的 HTTPS 证书链在 Node.js 环境下校验不完整，因此云函数中对固定教务系统客户端配置了 TLS 兼容处理。这个配置只作用于 `https://jxgl.wtbu.edu.cn` 请求。

## 新增学校适配

学校列表以云函数内的学校注册表为准。新增学校时：

1. 在 `cloudfunctions/getSchedule/schools/` 下新增学校适配器文件，实现登录、课表、成绩、考试和资料查询函数。
2. 在 `cloudfunctions/getSchedule/schools/index.js` 注册学校的 `id`、名称、别名和适配器。
3. 重新上传部署 `getSchedule` 云函数，绑定页会自动读取新的学校列表。

如果学校后续更换教务系统、增加验证码或修改课表页面脚本，只需要调整对应学校适配器。
