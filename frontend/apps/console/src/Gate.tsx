import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ApiError, Auth, Node } from "@itulah/client";

const auth = new Auth(new Node());
const meKey = ["auth", "me"] as const;

/// Nothing is shown until somebody is signed in.
///
/// Not a courtesy: every route behind this refuses an anonymous request
/// anyway, so a console that rendered its screens first would show a shell
/// full of failures and make the operator guess that the answer is "log in".
export function Gate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => auth.me(signal),
    // A 401 here is the answer, not a fault worth retrying.
    retry: false,
  });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: () => auth.login(username, password),
    onSuccess: () => {
      setPassword("");
      void queryClient.invalidateQueries();
    },
  });

  if (me.isPending) {
    return <p className="stack">Memeriksa sesi…</p>;
  }

  if (me.data) {
    return <>{children}</>;
  }

  return (
    <main className="stack" style={{ maxWidth: 320, margin: "10vh auto" }}>
      <h1>Masuk</h1>
      <form
        className="stack"
        style={{ padding: 0 }}
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        <label className="f">
          <span>Nama pengguna</span>
          <input
            className="inp"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="f">
          <span>Kata sandi</span>
          <input
            className="inp"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {signIn.error ? (
          <p className="hint" role="alert">
            {signIn.error instanceof ApiError
              ? signIn.error.message
              : "Tidak bisa masuk."}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={signIn.isPending || username === "" || password === ""}
        >
          {signIn.isPending ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}
