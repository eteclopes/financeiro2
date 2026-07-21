jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const bcrypt = require('bcryptjs');
const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const AppError = require('../../src/utils/AppError');
const { login, register, forgotPassword, resetPassword, updateProfile } = require('../../src/modules/auth/auth.service');

beforeEach(() => installDefaults(prismaMock));

describe('login — fix de timing attack (enumeração de e-mail)', () => {
  test('senha correta faz login com sucesso', async () => {
    const passwordHash = await bcrypt.hash('minhasenha123', 12);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1n, name: 'Ana', email: 'ana@teste.com', createdAt: new Date(), passwordHash,
    });
    prismaMock.refreshToken.create.mockResolvedValue({});

    const result = await login({ email: 'ana@teste.com', password: 'minhasenha123' });

    expect(result.user.email).toBe('ana@teste.com');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  }, 10000);

  test('senha errada com e-mail existente é rejeitada com AppError 401 genérico', async () => {
    const passwordHash = await bcrypt.hash('senhacerta', 12);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1n, name: 'Ana', email: 'ana@teste.com', createdAt: new Date(), passwordHash,
    });

    await expect(login({ email: 'ana@teste.com', password: 'senhaerrada' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  }, 10000);

  test('e-mail inexistente é rejeitado com a MESMA mensagem/código genérico (não revela que o e-mail não existe)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const promise = login({ email: 'naoexiste@teste.com', password: 'qualquer' });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }, 10000);

  test('REGRESSÃO: bcrypt.compare roda mesmo quando o e-mail não existe (contra o hash "morto") — sem isso, o tempo de resposta denuncia quais e-mails têm conta', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const compareSpy = jest.spyOn(bcrypt, 'compare');

    await expect(login({ email: 'naoexiste@teste.com', password: 'qualquer' })).rejects.toBeInstanceOf(AppError);

    expect(compareSpy).toHaveBeenCalledTimes(1);
    // o hash "morto" não pode ser undefined/vazio — senão bcrypt.compare
    // rejeitaria rápido demais e o timing attack voltaria a existir.
    const hashUsed = compareSpy.mock.calls[0][1];
    expect(typeof hashUsed).toBe('string');
    expect(hashUsed.length).toBeGreaterThan(0);

    compareSpy.mockRestore();
  }, 10000);
});

describe('AuditLog — ações sensíveis de autenticação ficam registradas', () => {
  test('register grava um audit log (e a criação da conta funciona mesmo que o log falhe)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null); // e-mail livre
    prismaMock.user.create.mockResolvedValue({ id: 42n, name: 'Bia', email: 'bia@teste.com', createdAt: new Date() });
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.auditLog.create.mockRejectedValue(new Error('boom')); // simula falha no log

    const result = await register({ name: 'Bia', email: 'bia@teste.com', password: 'senha12345' });

    // a conta foi criada e a sessão emitida normalmente — uma falha ao
    // registrar o audit log NUNCA pode impedir a operação de negócio.
    expect(result.user.email).toBe('bia@teste.com');
    expect(result.accessToken).toBeDefined();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 42n, entity: 'user', action: 'register' }) })
    );
  }, 10000);

  test('login bem-sucedido grava audit log com action=login', async () => {
    const passwordHash = await bcrypt.hash('minhasenha123', 12);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7n, name: 'Ana', email: 'ana@teste.com', createdAt: new Date(), passwordHash });
    prismaMock.refreshToken.create.mockResolvedValue({});

    await login({ email: 'ana@teste.com', password: 'minhasenha123' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 7n, entityId: 7n, action: 'login' }) })
    );
  }, 10000);

  test('login que falha (senha errada) NÃO grava audit log de login', async () => {
    const passwordHash = await bcrypt.hash('certa', 12);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7n, passwordHash });

    await expect(login({ email: 'ana@teste.com', password: 'errada' })).rejects.toBeInstanceOf(AppError);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  }, 10000);

  test('forgotPassword grava audit log só quando o e-mail existe', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 3n, email: 'ana@teste.com' });
    prismaMock.passwordReset.create.mockResolvedValue({});

    await forgotPassword('ana@teste.com');

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 3n, action: 'password_reset_requested' }) })
    );
  });

  test('forgotPassword para e-mail inexistente não grava nada (não há entidade para referenciar)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await forgotPassword('naoexiste@teste.com');

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  test('resetPassword (troca de senha efetiva) grava audit log — evento de segurança sensível', async () => {
    prismaMock.passwordReset.findUnique.mockResolvedValue({ id: 1n, userId: 9n, usedAt: null, expiresAt: new Date(Date.now() + 60000) });

    await resetPassword({ token: 'abc', password: 'novaSenha123' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 9n, action: 'password_reset_completed' }) })
    );
  });
});

describe('updateProfile — edição do nome de exibição', () => {
  test('atualiza o nome e devolve apenas os campos públicos do usuário (sem passwordHash)', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: 7n, name: 'Novo Nome', email: 'ana@teste.com', passwordHash: 'hash-secreto', createdAt: new Date(),
    });

    const result = await updateProfile(7n, { name: 'Novo Nome' });

    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { name: 'Novo Nome' } });
    expect(result).toEqual({ id: 7n, name: 'Novo Nome', email: 'ana@teste.com', createdAt: result.createdAt });
    expect(result.passwordHash).toBeUndefined();
  });

  test('grava audit log da alteração de nome', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 7n, name: 'Novo Nome', email: 'a@a.com', createdAt: new Date() });

    await updateProfile(7n, { name: 'Novo Nome' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 7n, entity: 'user', action: 'update' }) })
    );
  });
});
