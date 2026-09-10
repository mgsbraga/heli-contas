// Cifra, commita e envia. Usado tanto pelo CLI quanto pelo painel.
import { execFileSync } from 'node:child_process';
import { RAIZ, lerLedger, hojeISO } from './io.mjs';
import { build } from './build.mjs';

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });

/** Quantos arquivos estão esperando publicação (alterados ou novos). */
export function pendencias() {
  try {
    const sujo = git('status', '--porcelain').trim();
    const naoEnviados = git('rev-list', '--count', '@{u}..HEAD').trim();
    return {
      arquivos: sujo ? sujo.split('\n').length : 0,
      commitsNaoEnviados: Number(naoEnviados) || 0,
    };
  } catch {
    return { arquivos: 0, commitsNaoEnviados: 0, semRemoto: true };
  }
}

export async function publicar() {
  await build({ verboso: false });
  try {
    const sujo = git('status', '--porcelain').trim();
    const pendente = pendencias();

    if (!sujo && !pendente.commitsNaoEnviados) {
      return { ok: true, novidade: false, mensagem: 'Nada novo para publicar.' };
    }
    if (sujo) {
      git('add', '-A');
      git('commit', '-m', `contas: ${lerLedger().lancamentos.length} lançamentos — ${hojeISO()}`);
    }
    git('push');
    return { ok: true, novidade: true, mensagem: 'Publicado. O site atualiza em cerca de um minuto.' };
  } catch (e) {
    return { ok: false, mensagem: String(e.stderr || e.message).trim() };
  }
}
