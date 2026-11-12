import { initials, photoUrl } from '../../lib/photo.js';

/** Fotografia do utilizador (redonda) ou, sem ela, as iniciais. */
export default function Avatar({ user, size = 32 }) {
  const url = photoUrl(user);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {url ? <img src={url} alt="" width={size} height={size} /> : initials(user?.name)}
    </span>
  );
}
