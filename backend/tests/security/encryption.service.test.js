const crypto = require('node:crypto');

// Chaves de teste fixas: previsíveis e isoladas do ambiente real.
const KEK_V1 = crypto.randomBytes(32).toString('base64');
const KEK_V2 = crypto.randomBytes(32).toString('base64');
const LOOKUP_V1 = crypto.randomBytes(32).toString('base64');

function loadService(env = {}) {
  jest.resetModules();
  for (const k of Object.keys(process.env)) {
    if (/^(DATA_KEK|EMAIL_LOOKUP_KEY|ENCRYPTION_REQUIRED)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, env);
  const svc = require('../../src/security/encryption.service');
  svc.resetKeyringCache();
  return svc;
}

const BASE_ENV = {
  DATA_KEK_V1: KEK_V1,
  DATA_KEK_CURRENT_VERSION: '1',
  EMAIL_LOOKUP_KEY_V1: LOOKUP_V1,
  EMAIL_LOOKUP_CURRENT_VERSION: '1',
};

let enc;
beforeEach(() => { enc = loadService({ ...BASE_ENV }); });

describe('Criptografia de campos', () => {
  test('ida e volta preserva o texto, inclusive acentos e emoji', () => {
    const dek = enc.generateUserDataKey();
    const texto = 'Aluguel do apartamento — junho ☕';
    const cifrado = enc.encryptWithDataKey(dek, texto);

    expect(cifrado).not.toBe(texto);
    expect(cifrado).not.toContain('Aluguel');
    expect(enc.decryptWithDataKey(dek, cifrado)).toBe(texto);
  });

  test('o mesmo texto gera cifras DIFERENTES (nonce novo a cada vez)', () => {
    const dek = enc.generateUserDataKey();
    const a = enc.encryptWithDataKey(dek, 'Salário');
    const b = enc.encryptWithDataKey(dek, 'Salário');

    // Sem isso, quem olha o banco descobre que dois registros são iguais.
    expect(a).not.toBe(b);
    expect(enc.decryptWithDataKey(dek, a)).toBe('Salário');
    expect(enc.decryptWithDataKey(dek, b)).toBe('Salário');
  });

  test('adulterar a tag de autenticação faz a leitura FALHAR', () => {
    const dek = enc.generateUserDataKey();
    const cifrado = enc.encryptWithDataKey(dek, 'Mercado');
    const partes = cifrado.split(':');
    const tag = Buffer.from(partes[4], 'base64');
    tag[0] ^= 0xff; // vira um bit
    partes[4] = tag.toString('base64');

    expect(() => enc.decryptWithDataKey(dek, partes.join(':'))).toThrow();
  });

  test('adulterar o texto cifrado faz a leitura FALHAR', () => {
    const dek = enc.generateUserDataKey();
    const cifrado = enc.encryptWithDataKey(dek, 'Farmácia');
    const partes = cifrado.split(':');
    const ct = Buffer.from(partes[3], 'base64');
    ct[0] ^= 0xff;
    partes[3] = ct.toString('base64');

    expect(() => enc.decryptWithDataKey(dek, partes.join(':'))).toThrow();
  });

  test('chave errada não abre o dado', () => {
    const dek = enc.generateUserDataKey();
    const outra = enc.generateUserDataKey();
    const cifrado = enc.encryptWithDataKey(dek, 'Conta de luz');

    expect(() => enc.decryptWithDataKey(outra, cifrado)).toThrow();
  });

  test('nulo, indefinido e string vazia passam intactos', () => {
    const dek = enc.generateUserDataKey();
    expect(enc.encryptWithDataKey(dek, null)).toBeNull();
    expect(enc.encryptWithDataKey(dek, undefined)).toBeUndefined();
    expect(enc.encryptWithDataKey(dek, '')).toBe('');
  });

  test('AAD amarra a cifra ao contexto: mudar o contexto invalida', () => {
    const dek = enc.generateUserDataKey();
    const cifrado = enc.encryptWithDataKey(dek, 'Nota privada', 'expense:42:notes');

    expect(enc.decryptWithDataKey(dek, cifrado, 'expense:42:notes')).toBe('Nota privada');
    // Mover o valor para outro registro deve quebrar.
    expect(() => enc.decryptWithDataKey(dek, cifrado, 'expense:99:notes')).toThrow();
  });
});

describe('Validação de envelope', () => {
  test('reconhece um envelope legítimo', () => {
    const dek = enc.generateUserDataKey();
    expect(enc.isEncryptedEnvelope(enc.encryptWithDataKey(dek, 'x'))).toBe(true);
  });

  test.each([
    ['texto puro', 'Aluguel'],
    ['prefixo errado', 'xyz:v1:AAAA:BBBB:CCCC'],
    ['partes de menos', 'enc:v1:AAAA:BBBB'],
    ['nonce de tamanho errado', 'enc:v1:AA:BBBB:CCCC'],
    ['versão inválida', 'enc:vX:AAAA:BBBB:CCCC'],
    ['número', 12345],
    ['nulo', null],
  ])('rejeita: %s', (_label, valor) => {
    expect(enc.isEncryptedEnvelope(valor)).toBe(false);
  });

  test('valor que SE DIZ criptografado mas está corrompido falha alto', () => {
    const dek = enc.generateUserDataKey();
    // Começa com o prefixo, logo não é dado legado: é corrupção. Devolver a
    // string crua aqui mostraria lixo ao usuário e esconderia o problema.
    expect(() => enc.decryptWithDataKey(dek, 'enc:v1:AA:BB:CC'))
      .toThrow(/inválido/i);
  });

  test('texto legado sem o prefixo continua passando direto', () => {
    const dek = enc.generateUserDataKey();
    expect(enc.decryptWithDataKey(dek, 'encomenda do mercado')).toBe('encomenda do mercado');
  });

  test('versão de formato desconhecida é rejeitada com código próprio', () => {
    const dek = enc.generateUserDataKey();
    const cifrado = enc.encryptWithDataKey(dek, 'teste').replace(':v1:', ':v9:');
    // isEncryptedEnvelope aceita v9 (formato futuro), mas a decifragem recusa.
    expect(enc.isEncryptedEnvelope(cifrado)).toBe(true);
    expect(() => enc.decryptWithDataKey(dek, cifrado))
      .toThrow(/não suportado/i);
  });
});

describe('DEK por usuário', () => {
  test('cada usuário recebe uma chave diferente', () => {
    const a = enc.generateUserDataKey();
    const b = enc.generateUserDataKey();
    expect(a.equals(b)).toBe(false);
    expect(a).toHaveLength(enc.KEY_BYTES);
  });

  test('embrulha e desembrulha corretamente', () => {
    const dek = enc.generateUserDataKey();
    const wrapped = enc.wrapUserDataKey(dek, 10n);

    expect(wrapped.startsWith('dek:v1:1:')).toBe(true);
    expect(wrapped).not.toContain(dek.toString('base64'));
    expect(enc.unwrapUserDataKey(wrapped, 10n).equals(dek)).toBe(true);
  });

  test('DEK embrulhada de um usuário NÃO abre em outro (AAD)', () => {
    const dek = enc.generateUserDataKey();
    const wrapped = enc.wrapUserDataKey(dek, 10n);

    // Copiar a coluna para outra conta não dá acesso.
    expect(() => enc.unwrapUserDataKey(wrapped, 99n)).toThrow();
  });

  test('usuário A não consegue ler o dado do usuário B', () => {
    const dekA = enc.generateUserDataKey();
    const dekB = enc.generateUserDataKey();
    const segredoDeB = enc.encryptWithDataKey(dekB, 'Empréstimo do banco');

    expect(() => enc.decryptWithDataKey(dekA, segredoDeB)).toThrow();
  });
});

describe('Rotação de KEK', () => {
  test('dado escrito com a KEK v1 continua legível depois de rotacionar', () => {
    const dek = enc.generateUserDataKey();
    const wrappedV1 = enc.wrapUserDataKey(dek, 10n);
    const cifrado = enc.encryptWithDataKey(dek, 'Financiamento');

    // Entra a v2 como corrente, mas a v1 continua configurada.
    enc = loadService({ ...BASE_ENV, DATA_KEK_V2: KEK_V2, DATA_KEK_CURRENT_VERSION: '2' });

    const dekAindaAbre = enc.unwrapUserDataKey(wrappedV1, 10n);
    expect(enc.decryptWithDataKey(dekAindaAbre, cifrado)).toBe('Financiamento');
  });

  test('re-embrulha para a versão corrente sem tocar nos textos', () => {
    const dek = enc.generateUserDataKey();
    const wrappedV1 = enc.wrapUserDataKey(dek, 10n);
    const cifrado = enc.encryptWithDataKey(dek, 'Cartão');

    enc = loadService({ ...BASE_ENV, DATA_KEK_V2: KEK_V2, DATA_KEK_CURRENT_VERSION: '2' });
    const wrappedV2 = enc.rotateUserDataKey(wrappedV1, 10n);

    expect(wrappedV2.startsWith('dek:v1:2:')).toBe(true);
    // Mesma DEK por dentro: o texto criptografado NÃO precisa ser reescrito.
    expect(enc.decryptWithDataKey(enc.unwrapUserDataKey(wrappedV2, 10n), cifrado)).toBe('Cartão');
  });

  test('rotação é no-op quando já está na versão corrente', () => {
    const wrapped = enc.wrapUserDataKey(enc.generateUserDataKey(), 10n);
    expect(enc.rotateUserDataKey(wrapped, 10n)).toBeNull();
  });

  test('KEK removida do ambiente impede abrir o dado antigo (erro claro)', () => {
    const wrappedV1 = enc.wrapUserDataKey(enc.generateUserDataKey(), 10n);
    // Sobe só com a v2: a v1 sumiu.
    enc = loadService({ DATA_KEK_V2: KEK_V2, DATA_KEK_CURRENT_VERSION: '2', EMAIL_LOOKUP_KEY_V1: LOOKUP_V1 });
    expect(() => enc.unwrapUserDataKey(wrappedV1, 10n))
      .toThrow(/não está configurada/i);
  });
});

describe('E-mail pesquisável (HMAC)', () => {
  test('normaliza espaços e maiúsculas de forma única', () => {
    expect(enc.normalizeEmail('  Joao@Exemplo.COM  ')).toBe('joao@exemplo.com');
  });

  test('NÃO remove ponto nem sufixo "+" (endereços distintos continuam distintos)', () => {
    // Tratar joao.silva@ e joaosilva@ como iguais bloquearia cadastros legítimos.
    expect(enc.normalizeEmail('joao.silva+extra@gmail.com')).toBe('joao.silva+extra@gmail.com');
    expect(enc.createEmailLookup('joao.silva@x.com')).not.toBe(enc.createEmailLookup('joaosilva@x.com'));
  });

  test('mesmo e-mail gera sempre o mesmo lookup (permite login e unicidade)', () => {
    expect(enc.createEmailLookup('a@b.com')).toBe(enc.createEmailLookup('  A@B.COM '));
  });

  test('e-mails diferentes geram lookups diferentes', () => {
    expect(enc.createEmailLookup('a@b.com')).not.toBe(enc.createEmailLookup('c@d.com'));
  });

  test('o lookup NÃO contém o e-mail e não é reversível', () => {
    const lookup = enc.createEmailLookup('joao@exemplo.com');
    expect(lookup).not.toContain('joao');
    expect(lookup).not.toContain('exemplo');
    expect(lookup).toMatch(/^hml:v1:[0-9a-f]{64}$/);
  });

  test('depende da CHAVE: sem ela, não dá para montar dicionário de e-mails', () => {
    const comChaveA = enc.createEmailLookup('joao@exemplo.com');
    const outra = loadService({
      ...BASE_ENV,
      EMAIL_LOOKUP_KEY_V1: crypto.randomBytes(32).toString('base64'),
    });
    expect(outra.createEmailLookup('joao@exemplo.com')).not.toBe(comChaveA);
  });

  test('durante a rotação, gera candidatos de todas as versões', () => {
    enc = loadService({
      ...BASE_ENV,
      EMAIL_LOOKUP_KEY_V2: crypto.randomBytes(32).toString('base64'),
      EMAIL_LOOKUP_CURRENT_VERSION: '2',
    });
    const candidatos = enc.createEmailLookupCandidates('joao@exemplo.com');
    expect(candidatos).toHaveLength(2);
    expect(candidatos[0]).toBe(enc.createEmailLookup('joao@exemplo.com')); // corrente primeiro
  });
});

describe('Compatibilidade durante a migração (deploy em fases)', () => {
  test('dado ANTIGO em texto puro continua sendo lido', () => {
    const dek = enc.generateUserDataKey();
    // Registro que ainda não passou pelo backfill.
    expect(enc.decryptWithDataKey(dek, 'Conta de água')).toBe('Conta de água');
  });

  test('dado novo e antigo convivem no mesmo fluxo', () => {
    const dek = enc.generateUserDataKey();
    const registros = ['Antigo em claro', enc.encryptWithDataKey(dek, 'Novo cifrado')];
    const lidos = registros.map((r) => enc.decryptWithDataKey(dek, r));
    expect(lidos).toEqual(['Antigo em claro', 'Novo cifrado']);
  });

  test('sem chaves configuradas o sistema opera em modo compatível', () => {
    const semChaves = loadService({});
    expect(semChaves.isEncryptionEnabled()).toBe(false);
    // Escrita passa direto: nada quebra antes de configurar as chaves.
    expect(semChaves.encryptForUser(null, 10n, 'Aluguel')).toBe('Aluguel');
    expect(semChaves.decryptForUser(null, 10n, 'Aluguel')).toBe('Aluguel');
  });

  test('ENCRYPTION_REQUIRED=true derruba a subida se faltar chave', () => {
    expect(() => loadService({ ENCRYPTION_REQUIRED: 'true' }).isEncryptionEnabled())
      .toThrow(/ENCRYPTION_REQUIRED/);
  });

  test('chave de tamanho errado é recusada na subida', () => {
    expect(() => loadService({ ...BASE_ENV, DATA_KEK_V1: 'YWJj' }).isEncryptionEnabled())
      .toThrow(/32 bytes/);
  });
});

describe('Máscaras para painel e logs', () => {
  test('mascara e-mail preservando o domínio', () => {
    expect(enc.maskEmail('joaosilva@gmail.com')).toBe('j********@gmail.com');
  });

  test('mascara nome mantendo só o primeiro', () => {
    expect(enc.maskName('João Pedro Silva')).toBe('João P. S.');
  });

  test('entradas vazias não vazam nada', () => {
    expect(enc.maskEmail('')).toBe('[e-mail oculto]');
    expect(enc.maskName(null)).toBe('[nome oculto]');
  });
});
