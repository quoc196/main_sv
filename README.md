# main-sv

Base backend Node.js — Express 5, ESM thuần JavaScript, 3 môi trường: **development / staging / production**.

## Yêu cầu

Node.js >= 20.11 (đang chạy trên v22).

## Cài đặt & chạy

```bash
npm install

npm run dev            # development, tự reload (node --watch)
npm run start:staging  # staging
npm run start:prod     # production
npm test               # chạy test với NODE_ENV=test
npm run lint           # eslint
npm run env:check      # in ra config đã resolve cho môi trường hiện tại
```

Kiểm tra nhanh:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/users
```

## Cơ chế 3 môi trường

`NODE_ENV` được xác định **trước**, rồi mới quyết định đọc file nào. Thứ tự nạp (cụ thể → chung),
và biến đã có sẵn trong process env **luôn thắng** file:

| Ưu tiên | Nguồn | Ghi chú |
|---|---|---|
| 1 (cao nhất) | Biến môi trường thật của process | systemd, PM2, Docker, CI |
| 2 | `.env.${NODE_ENV}.local` | Override cá nhân, đã gitignore |
| 3 | `.env.${NODE_ENV}` | Giá trị theo môi trường, có commit |
| 4 | `.env` | Mặc định dùng chung, đã gitignore |

Nhờ vậy production trên server chỉ cần inject secret qua env thật, không cần sửa file.

### Khác biệt giữa 3 môi trường

| | development | staging | production |
|---|---|---|---|
| Log | `debug`, pretty màu | `debug`, JSON | `info`, JSON |
| Stack trace trong response lỗi | có | không | không |
| Message lỗi 5xx | hiện thật | ẩn | ẩn |
| Rate limit | 1000 req/phút | 300 | 100 |
| CORS | `*` | domain staging | domain production |
| `trust proxy` | tắt | bật (1 hop) | bật (1 hop) |
| `JWT_SECRET` | có sẵn giá trị dev | tự điền | **bắt buộc**, thiếu là exit(1) |
| Grace shutdown | 5s | 10s | 15s |

### Validate config

Toàn bộ biến môi trường đi qua schema Zod trong `src/config/index.js`. Sai kiểu hoặc thiếu biến
bắt buộc thì process **thoát ngay lúc khởi động** kèm thông báo rõ ràng, thay vì chết giữa chừng lúc
đang chạy:

```
[config] Invalid environment for NODE_ENV="production".
Files loaded: .env.production
  - JWT_SECRET: String must contain at least 16 character(s)
```

`KEY=` (để trống) được coi như chưa cấu hình, nên các file template vẫn hợp lệ.

## Cấu trúc

```
src/
├── server.js                 # listen + graceful shutdown (SIGINT/SIGTERM)
├── app.js                    # lắp middleware & mount router
├── config/
│   ├── env.js                # nạp file .env theo NODE_ENV
│   ├── index.js              # schema Zod + object config đã validate
│   └── logger.js             # pino, tự redact header/field nhạy cảm
├── middlewares/
│   ├── requestId.js          # x-request-id, tái dùng id từ proxy nếu có
│   ├── httpLogger.js         # pino-http, bỏ qua /health
│   ├── validate.js           # validate params/body/query bằng Zod
│   ├── notFound.js
│   └── errorHandler.js       # gom mọi lỗi về 1 format JSON
├── routes/
│   ├── index.js              # router gốc của API
│   └── health.route.js       # /health, /health/live, /health/ready
├── modules/users/            # mẫu 1 module: route → controller → service
├── utils/                    # ApiError, catchAsync, response helpers
└── db/index.js               # chỗ cắm ORM/driver thật
tests/
```

## Quy ước response

Thành công:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

Lỗi:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [] },
  "requestId": "..."
}
```

Mọi response đều có header `x-request-id` trùng với `requestId` trong log — dùng để trace.

## Thêm một module mới

Copy `src/modules/users/` rồi đổi tên, sau đó đăng ký trong `src/routes/index.js`:

```js
router.use('/products', productRoutes);
```

Tầng service ném `ApiError.notFound(...)` / `ApiError.conflict(...)`; controller bọc trong
`catchAsync` nên không cần try/catch, error handler lo phần còn lại.

## Cắm database

`src/modules/users/user.service.js` đang dùng Map trong bộ nhớ làm ví dụ. Khi có DB thật:

1. Cài driver/ORM, điền `DATABASE_URL` trong file env tương ứng.
2. Viết `connect()` / `disconnect()` trong `src/db/index.js`.
3. Gọi `await connect()` trước `app.listen` ở `src/server.js`, và `await disconnect()` trong hàm `shutdown`.
4. Thêm check vào object `checks` của `/health/ready`.

Chữ ký các hàm trong service giữ nguyên, chỉ thay phần thân.

## Deploy

`.env.staging` và `.env.production` chỉ chứa giá trị không nhạy cảm và được commit. Secret
(`JWT_SECRET`, `DATABASE_URL`, ...) inject qua environment của deploy target:

```bash
# systemd
Environment=NODE_ENV=production
EnvironmentFile=/etc/main-sv/secrets.env

# pm2
pm2 start src/server.js --name main-sv --env production

# docker
docker run -e NODE_ENV=production -e JWT_SECRET=... -e DATABASE_URL=... image
```

Server nhận SIGTERM sẽ ngừng nhận request mới, chờ request đang chạy xong (tối đa
`SHUTDOWN_TIMEOUT_MS`) rồi mới thoát — deploy không rớt request.

### Render

`render.yaml` khai báo 2 service web, mỗi service bám một branch:

| Branch | Service | `NODE_ENV` | Log | Rate limit |
|---|---|---|---|---|
| `staging` | `main-sv-staging` | `staging` | `debug` | 300 |
| `main` | `main-sv` | `production` | `info` | 100 |

Tạo lần đầu: Render → **New → Blueprint** → chọn repo → **Apply**. Render đọc
`render.yaml` từ branch của Blueprint (`main`) và dựng cả hai service cùng lúc.

Sau đó mỗi push vào `staging` deploy staging, mỗi push vào `main` deploy production:

```bash
git push origin staging          # -> main-sv-staging
git checkout main && git merge staging && git push origin main   # -> main-sv
```

`PORT` do Render tự inject nên không khai báo trong `render.yaml`; dotenv không ghi đè
process env thật nên giá trị của Render luôn thắng `PORT` trong `.env.*`.

`JWT_SECRET` dùng `generateValue: true` — Render sinh riêng cho từng service, hai môi
trường không dùng chung secret. `DATABASE_URL` và các secret khác điền trong dashboard
của từng service, không commit vào file env.

Sửa `render.yaml` chỉ có hiệu lực khi thay đổi đã nằm trên `main` — sửa trên nhánh
`staging` thôi thì Render chưa đọc.
