# main-sv

Base backend Node.js — Express 5, ESM thuần JavaScript, 3 môi trường: **development / staging / production**.

## Yêu cầu

Node.js >= 20.11 (đang chạy trên v22).

## Cài đặt & chạy

```bash
npm install
npm run db:up          # Postgres 17 local qua Docker (main_sv_dev + main_sv_test)
npm run db:migrate     # apply migration lên main_sv_dev

npm run dev            # development, tự reload (node --watch)
npm run start:staging  # staging
npm run start:prod     # production
npm test               # chạy test với NODE_ENV=test
npm run lint           # eslint
npm run env:check      # in ra config đã resolve cho môi trường hiện tại
npm run db:down        # tắt Postgres local (dữ liệu vẫn giữ trong volume)
```

Kiểm tra nhanh:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/users
```

## Cơ chế 3 môi trường

`NODE_ENV` được xác định **trước**, rồi mới quyết định đọc file nào. Thứ tự nạp (cụ thể → chung),
và biến đã có sẵn trong process env **luôn thắng** file:

| Ưu tiên      | Nguồn                            | Ghi chú                            |
| ------------ | -------------------------------- | ---------------------------------- |
| 1 (cao nhất) | Biến môi trường thật của process | systemd, PM2, Docker, CI           |
| 2            | `.env.${NODE_ENV}.local`         | Override cá nhân, đã gitignore     |
| 3            | `.env.${NODE_ENV}`               | Giá trị theo môi trường, có commit |
| 4            | `.env`                           | Mặc định dùng chung, đã gitignore  |

Nhờ vậy production trên server chỉ cần inject secret qua env thật, không cần sửa file.

### Khác biệt giữa 3 môi trường

|                                | development             | staging                    | production                                 |
| ------------------------------ | ----------------------- | -------------------------- | ------------------------------------------ |
| Log                            | `debug`, pretty màu     | `debug`, JSON              | `info`, JSON                               |
| Stack trace trong response lỗi | có                      | không                      | không                                      |
| Message lỗi 5xx                | hiện thật               | ẩn                         | ẩn                                         |
| Rate limit                     | 1000 req/phút           | 300                        | 100                                        |
| CORS                           | `*` (không credentials) | `*` hoặc domain staging    | **bắt buộc** domain cụ thể, `*` là exit(1) |
| `trust proxy`                  | tắt                     | bật (1 hop)                | bật (1 hop)                                |
| `JWT_SECRET`                   | có sẵn giá trị dev      | **bắt buộc** (Render sinh) | **bắt buộc**, thiếu là exit(1)             |
| `DATABASE_URL`                 | tự điền                 | inject từ deploy target    | **bắt buộc**, thiếu là exit(1)             |
| Grace shutdown                 | 5s                      | 10s                        | 15s                                        |

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

### Quy tắc CORS

`CORS_ORIGINS=*` và `credentials: true` không bao giờ đi chung. Nếu bật wildcard, app gửi đúng
`Access-Control-Allow-Origin: *` và **tắt** `credentials` — chứ không phản chiếu origin của người
gọi, vì phản chiếu + credentials cho phép mọi website gọi API bằng cookie của khách truy cập.

Ở `production`, wildcard bị từ chối thẳng lúc boot:

```
[config] CORS_ORIGINS="*" is not allowed when NODE_ENV=production.
         List the exact frontend origins, comma-separated.
```

Muốn dùng cookie/session thì phải liệt kê origin cụ thể, cách nhau bằng dấu phẩy.

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
│   ├── requestId.js          # x-request-id, tái dùng id từ proxy nếu hợp lệ
│   ├── httpLogger.js         # pino-http, bỏ qua /health
│   ├── response.js           # gắn res.ok / res.created / res.paginated / res.noContent
│   ├── validate.js           # validate params/body/query bằng Zod
│   ├── notFound.js
│   └── errorHandler.js       # gom mọi lỗi về cùng envelope
├── routes/
│   ├── index.js              # router gốc của API
│   └── health.route.js       # /health, /health/live, /health/ready
├── modules/users/            # mẫu 1 module: route → controller → service
├── utils/
│   ├── ApiError.js           # lỗi có HTTP status + userMessage
│   ├── catchAsync.js
│   └── response.js           # bảng CODES + envelope dùng chung
└── db/index.js               # pool pg, query(), transaction(), ping()
migrations/                   # node-pg-migrate, chạy trong buildCommand
scripts/migrate.js            # wrapper lấy connection string từ config
tests/
```

## Quy ước response

Mọi endpoint nghiệp vụ trả về **cùng một envelope**, thành công hay lỗi. Client chỉ cần nhìn `code`:
`"00"` là thành công.

Thành công:

```json
{
  "code": "00",
  "message": "Thành công",
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

Lỗi:

```json
{
  "code": "02",
  "err_show_type": "TOAST",
  "message": "Dữ liệu không hợp lệ",
  "data": {},
  "details": [{ "path": "email", "message": "Invalid email" }],
  "requestId": "..."
}
```

`meta` chỉ có ở response phân trang, `details` chỉ có ở lỗi validate, `err_show_type` chỉ có ở lỗi.
Field nào không dùng thì **không xuất hiện**, không gửi `null`.

### Bảng code

Toàn bộ contract nằm trong `CODES` ở [`src/utils/response.js`](src/utils/response.js) — thêm/sửa một
dòng ở đó, không tự viết code rời ở call site:

| `code` | Key (ApiError)                     | HTTP      | `err_show_type` |
| ------ | ---------------------------------- | --------- | --------------- |
| `00`   | `SUCCESS`                          | 200 / 201 | —               |
| `01`   | `BAD_REQUEST`                      | 400       | `POPUP`         |
| `02`   | `VALIDATION_ERROR`                 | 400       | `TOAST`         |
| `03`   | `UNAUTHORIZED`                     | 401       | `REDIRECT`      |
| `04`   | `FORBIDDEN`                        | 403       | `POPUP`         |
| `05`   | `NOT_FOUND`                        | 404       | `TOAST`         |
| `06`   | `CONFLICT`                         | 409       | `POPUP`         |
| `07`   | `UNPROCESSABLE_ENTITY`             | 422       | `POPUP`         |
| `08`   | `TOO_MANY_REQUESTS`                | 429       | `TOAST`         |
| `09`   | `PAYLOAD_TOO_LARGE`                | 413       | `TOAST`         |
| `10`   | `SERVICE_UNAVAILABLE`              | 503       | `POPUP`         |
| `11`   | `INVALID_CREDENTIALS`              | 401       | `TOAST`         |
| `12`   | `TOKEN_EXPIRED`                    | 401       | `SILENT`        |
| `99`   | `INTERNAL_SERVER_ERROR` / fallback | 500       | `POPUP`         |

`err_show_type` cho frontend biết hiển thị `message` ở mức nào — `SILENT` / `TOAST` / `POPUP` /
`REDIRECT` — để quyết định đó nằm ở API, không phải đoán lại ở từng screen.

Key nào không có trong bảng sẽ rơi về `99`, nên tên nội bộ không bao giờ lọt ra wire. Riêng HTTP 4xx
chưa có dòng riêng (415, 405, ...) rơi về `01` `BAD_REQUEST` — lỗi do phía gọi, không được hiện
"hệ thống đang gặp sự cố".

### Gọi trong controller

`src/middlewares/response.js` gắn helper vào `res` (giống cách `pino-http` gắn `req.log`), nên
controller không import gì và không tự dựng envelope:

```js
res.ok(user); // 200
res.ok(user, { message: 'Cập nhật thành công' }); // 200, đổi message
res.created(user, { message: 'Tạo thành công' }); // 201
res.paginated(items, { page, limit, total }); // 200 + meta, tự tính totalPages
res.noContent(); // 204, không body
```

### message: log vs. user

`ApiError` tách làm hai:

```js
throw ApiError.conflict(`Email ${email} is already taken`, {
  userMessage: 'Email này đã được sử dụng',
});
```

|               | Nội dung                                | Đi đâu              |
| ------------- | --------------------------------------- | ------------------- |
| `message`     | chi tiết cho dev — id, email, internals | **chỉ vào log**     |
| `userMessage` | câu cho người dùng cuối                 | **chỉ ra response** |

Không truyền `userMessage` thì response dùng copy mặc định trong `CODES`. Nghĩa là message viết cho
dev **không bao giờ** lọt ra end user — kể cả lỗi 4xx — vì frontend sẽ show nguyên văn theo
`err_show_type`. Riêng `development` thì response dùng `message` thật cho dễ debug.

`/health*` **không** dùng envelope này: probe của Render/K8s chỉ cần status code, không nên phụ thuộc
format nghiệp vụ.

Mọi response đều có header `x-request-id` trùng với `requestId` trong log — dùng để trace.
Header `x-request-id` từ client chỉ được tái dùng nếu khớp `^[A-Za-z0-9_-]{1,64}$` (để nối trace qua
proxy); giá trị khác sẽ bị thay bằng UUID mới, tránh client tự bơm rác vào log.

## Xác thực & phân quyền

Access token (JWT, mặc định 15 phút) gửi qua header, refresh token (chuỗi ngẫu nhiên, mặc định 30
ngày) dùng để lấy access token mới. Không dùng cookie.

| Endpoint                     | Cần token | Body                        | Ghi chú                                      |
| ---------------------------- | --------- | --------------------------- | -------------------------------------------- |
| `POST /api/v1/auth/register` | —         | `{ name, email, password }` | luôn tạo role `user`; trả session            |
| `POST /api/v1/auth/login`    | —         | `{ email, password }`       | trả session                                  |
| `POST /api/v1/auth/refresh`  | —         | `{ refreshToken }`          | trả session mới, token cũ hết hiệu lực       |
| `POST /api/v1/auth/logout`   | —         | `{ refreshToken }`          | `204`; chạy được cả khi access token hết hạn |
| `GET /api/v1/auth/me`        | có        | —                           | user hiện tại                                |
| `/api/v1/users/*`            | admin     |                             | quản lý user, gồm đổi `role` / `password`    |

Session trả về:

```json
{
  "user": { "id": "...", "name": "...", "email": "...", "role": "user" },
  "tokenType": "Bearer",
  "accessToken": "eyJ...",
  "expiresIn": 900,
  "refreshToken": "..."
}
```

Gọi API: `Authorization: Bearer <accessToken>`.

### Frontend xử lý 401 thế nào

| `code` | Nghĩa                                     | Frontend làm gì                                      |
| ------ | ----------------------------------------- | ---------------------------------------------------- |
| `12`   | access token hết hạn                      | gọi `/auth/refresh` **im lặng**, rồi gọi lại request |
| `11`   | sai email/mật khẩu                        | hiện lỗi trên form đăng nhập                         |
| `03`   | không có token / token giả / refresh hỏng | xoá token, về màn đăng nhập                          |

**Refresh phải chạy tuần tự.** Mỗi refresh token chỉ dùng được một lần (rotation). Nếu cùng một
token bị gửi hai lần — ví dụ hai tab cùng refresh — server coi là token bị đánh cắp và **thu hồi cả
phiên đăng nhập đó**. Frontend cần một lock/promise dùng chung cho lần refresh đang chạy.

### Những điều cần biết

- Mật khẩu hash bằng `scrypt` (có sẵn trong Node, không cần build native). Tối thiểu 8, tối đa 128 ký tự.
- DB chỉ lưu SHA-256 của refresh token. Mỗi lần đăng nhập là một "family"; logout thu hồi family đó,
  không ảnh hưởng thiết bị khác.
- Admin đổi mật khẩu một user thì **mọi phiên** của user đó bị thu hồi.
- `requireAuth` không đọc DB, nên đổi role hoặc xoá user chỉ có hiệu lực khi access token hiện tại
  hết hạn (tối đa `JWT_EXPIRES_IN`). Role mới được lấy ở lần refresh kế tiếp.
- `login` / `register` có rate limit riêng: `AUTH_RATE_LIMIT_MAX` lần mỗi `RATE_LIMIT_WINDOW_MS` mỗi IP.
- Token có `iss` = `APP_NAME`, nên token staging không dùng được ở production.

### Admin đầu tiên

API không cho tự nâng quyền, nên admin đầu tiên được cấp từ shell có quyền vào DB:

```bash
npm run user:promote -- you@example.com
```

Staging/production trên Render gói free không có Shell, nên chạy từ máy local và trỏ thẳng vào DB của
môi trường đó (dùng connection string **external** lấy từ dashboard của provider DB):

```bash
DATABASE_URL='postgresql://...' npm run user:promote -- you@example.com
```

### Bảo vệ route mới

```js
import { requireAuth, requireRole } from '../../middlewares/auth.js';

router.use(requireAuth);                        // mọi route bên dưới cần đăng nhập
router.delete('/:id', requireRole('admin'), …); // riêng route này cần admin
```

Trong controller, người gọi là `req.user` = `{ id, role }`.

## Thêm một module mới

Copy `src/modules/users/` rồi đổi tên, sau đó đăng ký trong `src/routes/index.js`:

```js
router.use('/products', productRoutes);
```

Tầng service ném `ApiError.notFound(...)` / `ApiError.conflict(...)` kèm `userMessage`; controller
bọc trong `catchAsync` nên không cần try/catch và chỉ gọi `res.ok` / `res.created` / `res.paginated`,
error handler lo phần còn lại.

## Database

**PostgreSQL**, truy cập bằng [`pg`](https://node-postgres.com) thuần + migration bằng
[`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/). Không ORM: repo là JavaScript thuần
nên phần lời lớn nhất của Prisma/Drizzle (sinh type) không dùng được, trong khi vẫn phải trả giá
codegen + schema DSL riêng.

`src/db/index.js` là **file duy nhất** biết đến `pg`. Đổi driver sau này chỉ sửa một chỗ.

```bash
npm run db:migrate            # chạy migration chưa apply
npm run db:rollback           # lùi 1 migration
npm run db:new "add orders"   # sinh file migration mới trong migrations/
```

Không set `DATABASE_URL` thì `db:migrate` là no-op và app vẫn boot: `/health*` hoạt động, mọi route
cần DB trả `503` (code `10`) — nhưng `NODE_ENV=production` thì **bắt buộc** có, thiếu là `exit(1)`.

### Pooled vs. direct URL

| Biến                    | Dùng cho    | Ghi chú                                                                  |
| ----------------------- | ----------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`          | app runtime | dùng string **pooled** (hostname có `-pooler`) nếu provider có PgBouncer |
| `DATABASE_URL_UNPOOLED` | migration   | string **direct**; bỏ trống thì fallback về `DATABASE_URL`               |

Pooler ở transaction mode (Neon, Supabase, RDS Proxy) không giữ được advisory lock và session state mà
`node-pg-migrate` cần, nên migration phải đi đường direct. Postgres trần không có pooler thì chỉ cần
`DATABASE_URL`.

`DB_POOL_MAX` mặc định `5`: pooler phía trên mới là chỗ fan out, còn mỗi instance giữ nhiều connection
idle là cách nhanh nhất để hết quota free tier.

### Migration chạy lúc nào

Trong `buildCommand` của Render: `npm ci && npm run db:migrate && npm prune --omit=dev`. Migration
fail thì build fail và deploy dừng, chứ không boot lên rồi chạy trên schema cũ. `npm prune` sau đó bỏ
devDependencies khỏi service đang chạy.

### Constraint trùng với Zod là có chủ ý

Zod chặn ở biên HTTP; constraint trong `migrations/` chặn ở tầng dữ liệu và vẫn còn hiệu lực với một
script, một migration hay một session `psql` không đi qua Express. Trên bảng `users`:
`UNIQUE(email)`, `CHECK` độ dài `name`, `CHECK` email đã lowercase + có `@`.

`UNIQUE(email)` cũng đóng một race thật: cách cũ `SELECT` rồi `INSERT` cho 2 request đăng ký cùng
email cùng lúc đều lọt. Giờ service để constraint quyết định và bắt mã lỗi `23505` → `409`.

### Viết thêm query

`query()` cho câu lẻ, `transaction()` khi ghi nhiều dòng và không được nửa vời:

```js
import { query, transaction } from '../../db/index.js';

await query('SELECT 1 FROM users WHERE id = $1', [id]);

await transaction(async (client) => {
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, from]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, to]);
});
```

Tiền thì dùng `NUMERIC`, **không** `float`. `pg` trả `NUMERIC` về dạng **string** đúng như vậy để
không mất độ chính xác — đừng `Number()` nó rồi đem đi tính.

### Chạy test có DB

Các suite chạy SQL thật (`users`, `transaction`) tự `describe.skip` khi không có `DATABASE_URL`. CI
luôn dựng một Postgres service nên chúng không bao giờ bị skip ở chỗ quan trọng. Local, sau
`npm run db:up`, tạo `.env.test.local` (đã gitignore):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main_sv_test
```

rồi `NODE_ENV=test npm run db:migrate && npm test`.

Suite có `TRUNCATE users` nên trỏ vào database dùng một lần, đừng trỏ vào DB dev đang có dữ liệu.

## CI

`.github/workflows/ci.yml` chạy trên mọi push và PR vào `staging` / `main`: lint, kiểm tra
format, migration lên một Postgres 17 service thật, test, kiểm tra migration `down` đảo lại được,
`npm audit` (chỉ runtime deps), và thử boot config `production`.

## CD

```
push staging ──► CI (check) ──pass──► Render deploy main-sv-staging
push main    ──► CI (check) ──pass──► Render deploy main-sv
                              fail──► không deploy
```

Cả hai service trong `render.yaml` đặt `autoDeployTrigger: checksPass`: Render chỉ deploy commit
khi mọi GitHub check trên commit đó pass. CI đỏ thì service giữ nguyên bản đang chạy.

Nên bật thêm **branch protection** cho `main` (Settings → Branches): bắt buộc qua PR và yêu cầu job
`check` pass trước khi merge — để lỗi bị chặn ở PR, không phải đợi tới lúc push lên `main`.

Rollback: Render dashboard → service → **Events** → chọn deploy cũ → **Rollback**. Rollback chỉ
đổi code, không đổi schema; chỉ chạy `npm run db:rollback` (với `DATABASE_URL_UNPOOLED` của môi
trường đó) khi bản cũ không chạy được trên schema mới.

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

| Branch    | Service           | `NODE_ENV`   | Log     | Rate limit |
| --------- | ----------------- | ------------ | ------- | ---------- |
| `staging` | `main-sv-staging` | `staging`    | `debug` | 300        |
| `main`    | `main-sv`         | `production` | `info`  | 100        |

Tạo lần đầu: Render → **New → Blueprint** → chọn repo → **Apply**. Render đọc
`render.yaml` từ branch của Blueprint (`main`) và dựng cả hai service cùng lúc.

Sau đó mỗi push vào `staging` deploy staging, mỗi push vào `main` deploy production:

```bash
git push origin staging          # -> main-sv-staging
git checkout main && git merge staging && git push origin main   # -> main-sv
```

`PORT` do Render tự inject nên không khai báo trong `render.yaml`; dotenv không ghi đè
process env thật nên giá trị của Render luôn thắng `PORT` trong `.env.*`.

`CORS_ORIGINS` của production khai `sync: false` — Render hỏi giá trị lúc Apply và lưu trong
dashboard, không commit wildcard vào repo. `buildCommand` kết thúc bằng `npm prune --omit=dev` nên
devDependencies không lên service đang chạy.

`JWT_SECRET` dùng `generateValue: true` — Render sinh riêng cho từng service, hai môi
trường không dùng chung secret. `DATABASE_URL` và các secret khác điền trong dashboard
của từng service, không commit vào file env.

Sửa `render.yaml` chỉ có hiệu lực khi thay đổi đã nằm trên `main` — sửa trên nhánh
`staging` thôi thì Render chưa đọc.
