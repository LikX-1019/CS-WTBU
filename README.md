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

## 使用步骤

1. 用微信开发者工具导入本目录。
2. 在 `project.config.json` 中把 `appid` 改成你自己的小程序 AppID。
3. 开通云开发，并创建云环境。
4. 在 `miniprogram/app.js` 中把 `YOUR_CLOUD_ENV_ID` 改成云环境 ID。
5. 在云开发数据库中创建集合 `eduAccountBindings`。
6. 给云函数 `getSchedule` 配置环境变量 `EDU_PASSWORD_SECRET`，建议使用 32 字节随机 hex 字符串。
7. 在微信开发者工具中右键 `cloudfunctions/getSchedule`，选择“安装依赖”。
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
- 数据库集合建议只通过云函数读写，不要让小程序端直接读取绑定集合。

## 当前状态

已完成：

- 微信用户身份识别
- 教务账号绑定页
- 小程序课表展示页
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

如果学校后续更换教务系统、增加验证码或修改课表页面脚本，需要重新适配 `cloudfunctions/getSchedule/index.js`。
