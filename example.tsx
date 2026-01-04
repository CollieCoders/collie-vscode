import { Collie } from '@collie-lang/react';

interface Props {
  loggedIn: boolean;
  username: string;
  onLogin: () => void;
}

export function UserPanel({ loggedIn, username, onLogin }: Props) {
  return (
    <div className="user-panel">
      {/* Branch-only conversion example: select only one branch at a time. */}
      {loggedIn ? (
        <section className="user-info">
          <h2>Welcome back, {username}</h2>
        </section>
      ) : (
        <section className="logged-out">
          <button onClick={onLogin}>Log in</button>
        </section>
      )}

      {/* Full-block conversion example: select the entire conditional. */}
      {loggedIn ? (
        <section className="user-info">
          <h2>Welcome back, {username}</h2>
        </section>
      ) : (
        <section className="logged-out">
          <button onClick={onLogin}>Log in</button>
        </section>
      )}
    </div>
  );
}
