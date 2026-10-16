// TILL-01..03: the web till's sign-in card (Masuk ke konter), its refusals and sign-out.
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { PASSWORD } from '../support/base.ts';
import * as pos from '../support/pos.ts';
import { countUncounted, ensureShift, scanField } from '../support/pos.ts';

test('dian signs in on the till and lands on the counter', { tags: ['pos', 'smoke'] }, async ({ app, screen, browser }) => {
  await countUncounted();
  await ensureShift();
  await app.open('/');
  await expect(screen.getByRole('heading', 'Masuk ke konter')).toBeVisible();
  // The card names the node it signs in against, and this edition is the web one.
  await expect(screen.getByText(/KASIR-1|WEB-/)).toBeVisible();
  await screen.getByLabel('Nama pengguna').fill('dian');
  await screen.getByLabel('Kata sandi').fill(PASSWORD);
  await screen.getByRole('button', 'Masuk').tap();
  await expect(scanField(screen)).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('Siap untuk transaksi baru', { exact: true })).toBeVisible();
  await expect(screen.getByText('Web', { exact: true })).toBeVisible();
  await expect(screen.getByText('Kasir 1', { exact: true })).toBeVisible();
});

test('TILL-02 a wrong password is refused in the node\'s words, the card stays and the field is emptied', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Nama pengguna').fill('dian');
  await screen.getByLabel('Kata sandi').fill('bukan-sandinya');
  await screen.getByRole('button', 'Masuk').tap();
  await expect(screen.getByText('unauthorized: invalid username or password', { exact: true })).toBeVisible();
  await expect(screen.getByRole('heading', 'Masuk ke konter')).toBeVisible();
  // Emptied whichever way the node answered, so Masuk is disabled again.
  await expect(screen.getByRole('button', 'Masuk')).toBeDisabled();
});

test('TILL-03 Masuk stays disabled until both fields are filled; the web edition offers no PIN or fingerprint', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/');
  const masuk = screen.getByRole('button', 'Masuk');
  await expect(masuk).toBeDisabled();
  await screen.getByLabel('Nama pengguna').fill('dian');
  await expect(masuk).toBeDisabled();
  await screen.getByLabel('Kata sandi').fill('x');
  await expect(masuk).toBeEnabled();
  await expect(screen.getByRole('button', 'PIN')).toBeHidden();
  await expect(screen.getByRole('button', 'Masuk dengan sidik jari')).toBeHidden();
  await expect(screen.getByRole('button', 'Gabungkan')).toBeHidden();
});

test('TILL-04 Setelan (before signing in): the node address is read-only in the web edition, no devices or pairing', { tags: ['pos'] }, async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', 'Setelan').tap();
  await expect(screen.getByRole('heading', 'Setelan terminal')).toBeVisible();
  await expect(screen.getByText('Alamat node toko', { exact: false }).first()).toBeVisible();
  await expect(screen.getByText(/^http:\/\/127\.0\.0\.1:5584$/)).toBeVisible();
  await expect(screen.getByText('Atur perangkat', { exact: true })).toBeHidden();
  await expect(screen.getByText('Pasangkan terminal ini', { exact: true })).toBeHidden();
  await screen.getByLabel('Nomor terminal').fill('');
  await screen.getByRole('button', 'Simpan').tap();
  await expect(screen.getByText(/^Nomor terminal tidak boleh kosong/)).toBeVisible();
  await screen.getByLabel('Nomor terminal').fill('WEB-E2E');
  await screen.getByLabel('Alamat printer struk').fill('192.168.1.50');
  await screen.getByRole('button', 'Simpan').tap();
  await expect(screen.getByRole('heading', 'Masuk ke konter')).toBeVisible();
  await expect(screen.getByText(/WEB-E2E/)).toBeVisible();
});

test('TILL-05 Keluar signs the cashier out and the next person gets an empty card', { tags: ['pos'] }, async (fx) => {
  const { screen } = fx;
  await pos.openCounter(fx);
  await screen.getByRole('button', 'Keluar').tap();
  await expect(screen.getByRole('heading', 'Masuk ke konter')).toBeVisible();
  await expect(screen.getByLabel('Nama pengguna')).toHaveValue('');
  // The node token is gone: a reload does not bring the counter back.
  await fx.browser.reload();
  await expect(screen.getByRole('heading', 'Masuk ke konter')).toBeVisible();
});
