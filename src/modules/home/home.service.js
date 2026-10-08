/**
 * The home screen's quick actions. Fixed in code: four entries that change
 * with a frontend release do not need a table. Move them to the database once
 * they have to be edited without a deploy, or differ per user.
 *
 * `icon` is a name the app maps to its own icon set; `router` is the app route
 * to open on tap.
 */
const HOME_ACTIONS = Object.freeze([
  { icon: 'user', title: 'Tài khoản', router: '/profile' },
  { icon: 'bell', title: 'Thông báo', router: '/notifications' },
  { icon: 'history', title: 'Lịch sử', router: '/history' },
  { icon: 'settings', title: 'Cài đặt', router: '/settings' },
]);

export function listActions() {
  return HOME_ACTIONS;
}
