var AutoEditalUtils = Class.create();
AutoEditalUtils.prototype = (function() {
    'use strict';

    /**
     * \n ARQUITETURA GERAL
     * - Mantém compatibilidade com o nome da classe e métodos públicos principais (quando possível).
     * - Centraliza constantes, utilitários e padrões de log.
     * - Reduz duplicação em RN08 e RN10 via handlers parametrizados.
     * - Converte "magic numbers" em CONFIG.
     * - Aplica early-return, validações defensivas e utilitários de datas/records.
     * - Fornece um "RuleEngine" simples para organização/descoberta de regras.
     */

    // =========================
    // CONFIG & CONSTANTES
    // =========================
    var CONFIG = {
        PRAZO_PRESCRICAO_EXECUTORIA_ANOS: 5,
        PRAZO_RN09_DIAS: 97,
        PRAZO_UM_MES: 1,
        PRAZO_RN11_DIAS_MIN: 30,
        PRAZO_TRES_ANOS_EM_DIAS: 365 * 3, // 1095
        TABELAS: {
            AUTO: 'x_g4fsc_divida_a_0_divida_ativa',
            EDITAL_NP: 'x_g4fsc_divida_a_0_dnit_editais_np',
            EDITAL_NA: 'x_g4fsc_divida_a_0_editais_na'
        },
        CAMPOS: {
            LOG_BR: 'business_rules_logs',
            OBS: 'u_observacoes',
            STAGE: 'stage',
            STATUS_SIOR: 'status_sior',
            RN07: 'rn07',
            RN08: 'rn08',
            RN09: 'rn09',
            RN10: 'rn10',
            RN11: 'rn11',
            RN12: 'rn12',
            RN13: 'rn13',
            RN30: 'rn30'
        },
        STAGES: {
            REVISAO: 6,
            REVISAO_SUP: 'Em Revisão (Supervisor)'
        },
        STATUS: {
            REVISAO_SAPIENS: 'revis_o_do_sapiens'
        }
    };

    // =========================
    // UTILITÁRIOS DE DATAS
    // =========================
    var DateUtil = {
        toGDT: function(value) {
            return (value instanceof GlideDateTime) ? value : new GlideDateTime(value);
        },
        hoje: function() { return new GlideDateTime(); },
        addDias: function(data, dias) {
            var g = DateUtil.toGDT(data);
            g.addDaysLocalTime(Number(dias || 0));
            return g;
        },
        addAnos: function(data, anos) {
            var g = DateUtil.toGDT(data);
            g.addYearsLocalTime(Number(anos || 0));
            return g;
        },
        primeiroDiaMesSeguinte: function(data) {
            var g = DateUtil.toGDT(data);
            g.addMonthsUTC(1);
            g.setDayOfMonthUTC(1);
            return g.getDate().getDisplayValue();
        },
        diffDias: function(a, b) {
            var ga = DateUtil.toGDT(a); var gb = DateUtil.toGDT(b);
            var MS_PER_DAY = 1000 * 60 * 60 * 24;
            return Math.ceil((ga.getNumericValue() - gb.getNumericValue()) / MS_PER_DAY);
        },
        before: function(a, b) {
            var ga = DateUtil.toGDT(a), gb = DateUtil.toGDT(b);
            return ga.before(gb);
        },
        gte: function(a, b) {
            var ga = DateUtil.toGDT(a), gb = DateUtil.toGDT(b);
            return ga.getNumericValue() >= gb.getNumericValue();
        },
        toBR: function(data) {
            var g = DateUtil.toGDT(data);
            var s = g.getDisplayValue(); // YYYY-MM-DD HH:mm:ss
            var d = (s || '').split(' ')[0];
            var p = (d || '').split('-');
            return (p[2] || '') + '/' + (p[1] || '') + '/' + (p[0] || '');
        }
    };

    // =========================
    // UTILITÁRIOS DE REGISTRO
    // =========================
    var RecordUtil = {
        exists: function(obj) { return !!obj; },
        getByField: function(table, field, value) {
            if (!value) return null;
            var gr = new GlideRecord(table);
            return gr.get(field, String(value)) ? gr : null;
        },
        firstBy: function(table, field, value) {
            if (!value) return null;
            var gr = new GlideRecord(table);
            gr.addQuery(field, value);
            gr.setLimit(1);
            gr.query();
            return gr.next() ? gr : null;
        },
        set: function(record, field, value) {
            if (!record) return; record.setValue(field, value);
        },
        update: function(record) { if (record) record.update(); },
        append: function(record, field, msg) {
            if (!record) return;
            record[field] = (record[field] || '') + String(msg || '');
        }
    };

    // =========================
    // LOGGER
    // =========================
    var Logger = {
        br: function(record, msg) { RecordUtil.append(record, CONFIG.CAMPOS.LOG_BR, '\n ' + msg); },
        obs: function(record, msg) { RecordUtil.append(record, CONFIG.CAMPOS.OBS, '\n' + msg); }
    };

    // =========================
    // PREDICADOS E HELPERS
    // =========================
    function eq(a, b) { return String(a) === String(b); }
    function notEmpty(v) { return v !== undefined && v !== null && String(v) !== ''; }
    function ateTresAnos(diffDias) { return Number(diffDias) <= CONFIG.PRAZO_TRES_ANOS_EM_DIAS; }

    // =========================
    // HANDLERS COMUNS (RN08/RN10)
    // =========================
    function handleRN08(current, opts) {
        // opts: { getPostNA(), getPostNP(), adesaoField, autoBy: {fieldOnAuto, valueFromCurrent}, msgIf, msgElse }
        if (!RecordUtil.exists(current)) return false;

        var numero = String(current.getValue('number') || '');
        if (!numero) return false;

        var auto = RecordUtil.getByField(CONFIG.TABELAS.AUTO, 'number', numero);
        if (!RecordUtil.exists(auto)) return false;

        var adesao = current.getValue('sior_adesao_sne');
        var postNA = opts.getPostNA ? current.getValue(opts.getPostNA) : null;
        var postNP = opts.getPostNP ? current.getValue(opts.getPostNP) : null;
        if (!adesao || (!postNA && !postNP)) return false;

        var condOK = true;
        if (postNA) condOK = condOK && DateUtil.before(adesao, postNA);
        if (postNP) condOK = condOK && DateUtil.before(adesao, postNP);

        if (condOK) {
            RecordUtil.set(auto, CONFIG.CAMPOS.RN08, true);
            RecordUtil.update(auto);
            Logger.br(current, opts.msgIf);
        } else {
            RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
            Logger.obs(current, opts.obsElse);
            Logger.br(current, opts.msgElse);
            RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
            RecordUtil.set(auto, CONFIG.CAMPOS.RN08, false);
            RecordUtil.update(auto);
        }
        return true;
    }

    function handleRN10(current, conds, mensagens) {
        // conds: array<boolean> todas precisam ser true
        // mensagens: { ifMsg, elseMsg, elseObs }
        if (!RecordUtil.exists(current)) return false;
        var ok = true;
        for (var i = 0; i < conds.length; i++) ok = ok && !!conds[i];

        if (ok) {
            RecordUtil.set(current, CONFIG.CAMPOS.RN10, true);
            RecordUtil.set(current, 'ap_paralisado_por_mais_de_3_anos', 'Não');
            Logger.br(current, mensagens.ifMsg);
        } else {
            RecordUtil.set(current, CONFIG.CAMPOS.RN10, false);
            RecordUtil.set(current, 'ap_paralisado_por_mais_de_3_anos', 'Sim');
            RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
            RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
            Logger.obs(current, mensagens.elseObs);
            Logger.br(current, mensagens.elseMsg);
        }
        return true;
    }

    // =========================
    // API PÚBLICA
    // =========================
    var api = {
        initialize: function() {},

        // -------------- RN01 --------------
        applyRN01: function(current) {
            if (!RecordUtil.exists(current)) return false;

            var auto = RecordUtil.getByField(
                CONFIG.TABELAS.AUTO,
                'sior_n_auto_infracao_transito',
                String(current.getValue('sior_n_auto_infracao_transito'))
            );
            if (!RecordUtil.exists(auto)) return false;

            var editalNP = RecordUtil.firstBy(CONFIG.TABELAS.EDITAL_NP, 'editais_np', current.getValue('edital_np'));
            var editalNA = RecordUtil.firstBy(CONFIG.TABELAS.EDITAL_NA, 'editais_na', current.getValue('edital_na'));

            if (RecordUtil.exists(editalNP)) {
                RecordUtil.set(auto, 'vencimento_edital_np', editalNP.getValue('data_venc_edital'));
                RecordUtil.set(auto, 'publicacao_dou_np', editalNP.getValue('data_dou_np'));
            }
            if (RecordUtil.exists(editalNA)) {
                RecordUtil.set(auto, 'vencimento_edital_na', editalNA.getValue('data_de_vencimento_edital'));
                RecordUtil.set(auto, 'publicacao_dou_na', editalNA.getValue('data_dou_na'));
            }
            RecordUtil.update(auto);
            Logger.br(current, 'RN01 - Definir Data de Vencimento do Auto - Edital');
            return true;
        },

        applyRN01_Misto_NAEdital_NPSNE: function(current) {
            if (!RecordUtil.exists(current)) return false;

            var auto = RecordUtil.getByField(
                CONFIG.TABELAS.AUTO,
                'sior_n_auto_infracao_transito',
                String(current.getValue('sior_n_auto_infracao_transito'))
            );
            if (!RecordUtil.exists(auto)) return false;

            var editalNA = RecordUtil.firstBy(CONFIG.TABELAS.EDITAL_NA, 'editais_na', current.getValue('edital_na'));
            if (!RecordUtil.exists(editalNA)) return false;

            RecordUtil.set(auto, 'vencimento_edital_na', editalNA.getValue('data_de_vencimento_edital'));
            RecordUtil.set(auto, 'publicacao_dou_na', editalNA.getValue('data_dou_na'));
            RecordUtil.update(auto);

            Logger.br(current, 'RN01 - Definir Data de Vencimento do Auto - Misto - NA_Edital + NP_SNE');
            RecordUtil.set(current, 'rn01', true);
            return true;
        },

        applyRN01_Misto_NASNE_NPEdital: function(current) {
            if (!RecordUtil.exists(current)) return false;

            var auto = RecordUtil.getByField(
                CONFIG.TABELAS.AUTO,
                'sior_n_auto_infracao_transito',
                String(current.getValue('sior_n_auto_infracao_transito'))
            );
            if (!RecordUtil.exists(auto)) return false;

            var editalNP = RecordUtil.firstBy(CONFIG.TABELAS.EDITAL_NP, 'editais_np', current.getValue('edital_np'));
            if (!RecordUtil.exists(editalNP)) return false;

            RecordUtil.set(auto, 'vencimento_edital_np', editalNP.getValue('data_venc_edital'));
            RecordUtil.set(auto, 'publicacao_dou_np', editalNP.getValue('data_dou_np'));
            RecordUtil.update(auto);

            Logger.br(current, 'RN01 - Definir Data de Vencimento do Auto - Misto - NA_SNE + NP_Edital');
            RecordUtil.set(current, 'rn01', true);
            return true;
        },

        // -------------- RN02 --------------
        applyRN02_PrescricaoExecutoria: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var dt = current.getValue('data_de_vencimento_do_ultimo_boleto');
            if (!dt) return false;
            var dtPresc = DateUtil.addAnos(dt, CONFIG.PRAZO_PRESCRICAO_EXECUTORIA_ANOS);
            RecordUtil.set(current, 'data_de_prescricao_executoria', dtPresc);
            Logger.br(current, 'RN02 - Prescrição Executória');
            return true;
        },

        // -------------- RN03 --------------
        applyRN03_ConstituicaoDefinitivaEMulta: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var dt = current.getValue('data_de_vencimento_do_ultimo_boleto');
            if (!dt) return false;
            var dtConst = DateUtil.addDias(dt, 1);
            RecordUtil.set(current, 'data_da_constituicao_definitiva', dtConst);
            RecordUtil.set(current, 'data_multa_mora', dtConst);
            Logger.br(current, 'RN03 - Constituição Definitiva e Multa de Mora');
            return true;
        },

        // -------------- RN05 --------------
        applyRN05_DataInicioTaxaSelic: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var dataVencUltimoBoleto = current.getValue('data_de_vencimento_do_ultimo_boleto');
            if (!dataVencUltimoBoleto) return false;
            var selic = DateUtil.toGDT(dataVencUltimoBoleto);
            selic.addMonthsUTC(CONFIG.PRAZO_UM_MES);
            selic.setDayOfMonthUTC(1);
            current.data_de_inicio_da_taxa_selic = selic.getDate().getDisplayValue();
            Logger.br(current, 'RN05 - Data de Início da Taxa SELIC');
            return true;
        },

        // -------------- RN07 (CPF) --------------
        applyRN07_ValidarSituacaoCadastralCPF: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var sior = current.getValue('situacao');
            var rf = current.getValue('integracao_rf_situacao_cadastral');
            var ok = eq(sior, 'Regular (0)') && eq(rf, 'Regular (0)');
            RecordUtil.set(current, CONFIG.CAMPOS.RN07, ok);
            if (ok) {
                Logger.br(current, 'RN07 [IF] - Validar Situação Cadastral - CPF');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.RN07, false);
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                Logger.obs(current, 'RN07 - Situação Cadastral irregular.');
                Logger.br(current, 'RN07 [ELSE] - Validar Situação Cadastral - CPF');
            }
            return true;
        },

        // -------------- RN07.2 (CNPJ) --------------
        applyRN072_ValidarSituacaoCadastralCNPJ: function(current) {
            if (!RecordUtil.exists(current)) return false;

            var tipoEstabelecimento = current.getValue('tipo');
            var situacaoCadastral = current.getValue('situacao');
            var motivoSituacaoMatriz = current.getDisplayValue('integracao_rf_motivo_da_situacao_cadastral_matriz');
            var situacaoCadastralMatriz = current.getValue('integracao_rf_situacao_cadastral_matriz');

            function starts(v, pref) { return String(v || '').indexOf(pref) === 0; }

            var cond1 = starts(tipoEstabelecimento, 'Matriz (1)') && starts(situacaoCadastral, 'Ativa (2)');
            var cond2 = starts(tipoEstabelecimento, 'Filial') && starts(situacaoCadastral, 'Ativa (2)');
            var cond3 = starts(tipoEstabelecimento, 'Filial') && starts(situacaoCadastral, 'Baixada') && starts(situacaoCadastralMatriz, 'Baixada');
            var cond4 = starts(tipoEstabelecimento, 'Filial') && starts(situacaoCadastral, 'Baixada') && starts(situacaoCadastralMatriz, 'Baixada') && starts(motivoSituacaoMatriz, 'Incorporação');
            var cond5 = starts(tipoEstabelecimento, 'Filial') && starts(situacaoCadastral, 'Baixada') && starts(situacaoCadastralMatriz, 'Baixada') && starts(motivoSituacaoMatriz, 'Cisão');
            var cond6 = starts(tipoEstabelecimento, 'Filial') && starts(situacaoCadastral, 'Baixada') && starts(situacaoCadastralMatriz, 'Ativa (2)') && starts(motivoSituacaoMatriz, 'Recuperação Judicial');

            var ok = cond1 || cond2 || cond3 || cond4 || cond5 || cond6;
            RecordUtil.set(current, CONFIG.CAMPOS.RN07, ok);
            if (ok) {
                Logger.br(current, 'RN07.2 [IFx] - Validar Situação Cadastral - CNPJ');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                Logger.obs(current, 'AIT inapto por Situação Cadastral do CNPJ');
                Logger.br(current, 'RN07.2 [ELSE] - Validar Situação Cadastral - CNPJ');
            }
            return true;
        },

        // -------------- RN08 --------------
        applyRN08_Misto_NASNE: function(current) {
            return handleRN08(current, {
                getPostNA: 'data_da_postagem_da_na',
                getPostNP: 'data_da_postagem_da_np',
                msgIf: 'RN08 [IF] - Conferir Adesão ao SNE - NA_SNE + NP_SNE',
                msgElse: 'RN08 [ELSE] - Conferir Adesão ao SNE - NA_SNE + NP_SNE',
                obsElse: 'Adesão ao SNE superior à [Data da Postagem] da NA ou da NP'
            });
        },
        applyRN08_Misto_NPSNE: function(current) {
            return handleRN08(current, {
                getPostNA: null,
                getPostNP: 'data_da_postagem_da_np',
                msgIf: 'RN08 [IF] - Conferir Adesão ao SNE - NA_Edital + NP_SNE',
                msgElse: 'RN08 [ELSE] - Conferir Adesão ao SNE - NA_Edital + NP_SNE',
                obsElse: 'Adesão ao SNE superior à [Data da Postagem] da NP'
            });
        },
        applyRN08_NASNE_NPSNE: function(current) {
            return handleRN08(current, {
                getPostNA: 'data_da_postagem_da_na',
                getPostNP: 'data_da_postagem_da_np',
                msgIf: 'RN08 [IF] - Conferir Adesão ao SNE - NA_SNE + NP_SNE',
                msgElse: 'RN08 [ELSE] - Conferir Adesão ao SNE - NA_SNE + NP_SNE',
                obsElse: 'Adesão ao SNE superior à [Data da Postagem] da NA ou da NP'
            });
        },

        // -------------- RN09 --------------
        applyRN09_ValidarPrescricaoExecutoriaPrazo: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var presc = current.getValue('data_de_prescricao_executoria');
            if (!presc) return false;
            var hojeMais97 = DateUtil.addDias(DateUtil.hoje(), CONFIG.PRAZO_RN09_DIAS);
            var ok = DateUtil.gte(presc, hojeMais97);
            RecordUtil.set(current, CONFIG.CAMPOS.RN09, ok);
            if (ok) {
                Logger.br(current, 'RN09 [IF] - Validar prescrição executória em relação ao dia atual');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.RN09, false);
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
                Logger.obs(current, 'RN09 - Falhou - Prescrição Executória - Data da prescrição executória em relação ao dia atual é inferior a ' + CONFIG.PRAZO_RN09_DIAS + ' dias');
                Logger.br(current, 'RN09 [ELSE] - Validar prescrição executória em relação ao dia atual');
            }
            return true;
        },

        // -------------- RN10 --------------
        applyRN10_PrescricaoIntercorrenteEdital: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var vencNA = current.getValue('vencimento_edital_na');
            var postNA = current.getValue('data_da_postagem_da_na');
            var douNP = current.getValue('publicacao_dou_np');
            var postNP = current.getValue('data_da_postagem_da_np');
            if (!vencNA || !postNA || !douNP || !postNP) return false;

            var diffNP = DateUtil.diffDias(douNP, postNP);
            var diffNA = DateUtil.diffDias(vencNA, postNA);

            return handleRN10(current,
                [ ateTresAnos(diffNA), ateTresAnos(diffNP) ],
                {
                    ifMsg: 'RN10 [IF] - Prescrição Intercorrente - Edital',
                    elseMsg: 'RN10 [ELSE] - Prescrição Intercorrente - Edital',
                    elseObs: 'RN10 - Falhou - Prescrição Intercorrente - Andamento do processo paralisado por mais de 3 anos'
                }
            );
        },

        applyRN10_PrescricaoIntercorrenteSNE: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var vencNA = current.getValue('data_vencimento_na');
            var postNA = current.getValue('data_da_postagem_da_na');
            var vencNP = current.getValue('data_vencimento_np');
            var postNP = current.getValue('data_da_postagem_da_np');
            if (!vencNA || !postNA || !vencNP || !postNP) return false;

            var diffNANA = DateUtil.diffDias(postNA, vencNA) * -1; // postNA - vencNA
            var diffNANP = DateUtil.diffDias(vencNA, postNP);
            var diffNPNP = DateUtil.diffDias(postNP, vencNP) * -1; // postNP - vencNP

            return handleRN10(current,
                [ ateTresAnos(diffNANA), ateTresAnos(diffNANP), ateTresAnos(diffNPNP) ],
                {
                    ifMsg: 'RN10 [IF] - Prescrição Intercorrente - SNE',
                    elseMsg: 'RN10 [ELSE] - Prescrição Intercorrente - SNE',
                    elseObs: 'RN10 - Falhou - Prescrição Intercorrente SNE - Andamento do processo paralisado por mais de 3 anos'
                }
            );
        },

        applyRN10_PrescricaoIntercorrente_Misto_NASNE_NPEdital: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var vencNA = current.getValue('data_vencimento_na');
            var postNA = current.getValue('data_da_postagem_da_na');
            var postNP = current.getValue('data_da_postagem_da_np');
            if (!vencNA || !postNA || !postNP) return false;

            var diffNP = DateUtil.diffDias(postNA, vencNA) * -1;
            var diffNA = DateUtil.diffDias(vencNA, postNP);

            return handleRN10(current,
                [ ateTresAnos(diffNA), ateTresAnos(diffNP) ],
                {
                    ifMsg: 'RN10 [IF] - Prescrição Intercorrente - Misto - NA_SNE + NP_Edital',
                    elseMsg: 'RN10 [ELSE] - Prescrição Intercorrente - Misto - NA_SNE + NP_Edital',
                    elseObs: 'RN10 - Falhou - Prescrição Intercorrente - Andamento do processo paralisado por mais de 3 anos'
                }
            );
        },

        applyRN10_PrescricaoIntercorrente_Misto_NAEdital_NPSNE: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var vencNP = current.getValue('data_vencimento_np');
            var postNP = current.getValue('data_da_postagem_da_np');
            if (!vencNP || !postNP) return false;

            var diffNP = DateUtil.diffDias(postNP, vencNP) * -1;

            return handleRN10(current,
                [ ateTresAnos(diffNP) ],
                {
                    ifMsg: 'RN10 [IF] - Prescrição Intercorrente - Misto - NA_Edital + NP_SNE',
                    elseMsg: 'RN10 [ELSE] - Prescrição Intercorrente - Misto - NA_Edital + NP_SNE',
                    elseObs: 'RN10 - Falhou - Prescrição Intercorrente - Andamento do processo paralisado por mais de 3 anos'
                }
            );
        },

        // -------------- RN11 --------------
        applyRN11_PrescricaoDecadencial: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var dtInf = current.getValue('data_da_infracao');
            var dtPos = current.getValue('data_da_postagem_da_na');
            if (!dtInf || !dtPos) return false;

            var diff = DateUtil.diffDias(dtPos, dtInf);
            if (diff >= CONFIG.PRAZO_RN11_DIAS_MIN) {
                RecordUtil.set(current, CONFIG.CAMPOS.RN11, true);
                Logger.br(current, 'RN11 [IF] - Prescrição Decadencial');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.RN11, false);
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
                Logger.obs(current, 'RN11 - Falhou - Prescrição Decadencial - Há mais de ' + CONFIG.PRAZO_RN11_DIAS_MIN + ' dias de diferença entre a data da postagem ' + DateUtil.toBR(dtPos) + ' e a data da infração ' + DateUtil.toBR(dtInf));
                Logger.br(current, 'RN11 [ELSE] - Prescrição Decadencial');
            }
            return true;
        },

        // -------------- RN12 --------------
        applyRN12_ValidarDebitoEmAberto: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var situacao = current.getValue('situacao_do_debito');
            var ok = eq(situacao, 'Em Aberto');
            RecordUtil.set(current, CONFIG.CAMPOS.RN12, ok);
            if (ok) {
                Logger.br(current, 'RN12 [IF] - Débito Em Aberto');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                Logger.obs(current, '[RN12] A situação do Débito é diferente de "Em Aberto"');
                Logger.br(current, 'RN12 [ELSE] - Débito Em Aberto');
            }
            return true;
        },

        // -------------- RN13 --------------
        applyRN13_ValidarDataDOC: function(current) {
            if (!RecordUtil.exists(current)) return false;
            var dataDoc = current.getValue('data_doc');
            if (!dataDoc) return false;
            var diff = DateUtil.diffDias(DateUtil.hoje(), dataDoc);
            if (diff >= CONFIG.PRAZO_RN11_DIAS_MIN) {
                RecordUtil.set(current, CONFIG.CAMPOS.RN13, true);
                Logger.br(current, 'RN13 [IF] - Validar campo [Data DOC]');
            } else {
                RecordUtil.set(current, CONFIG.CAMPOS.RN13, false);
                RecordUtil.set(current, CONFIG.CAMPOS.STAGE, CONFIG.STAGES.REVISAO);
                RecordUtil.set(current, CONFIG.CAMPOS.STATUS_SIOR, CONFIG.STATUS.REVISAO_SAPIENS);
                Logger.obs(current, '[RN13] Falhou - Há mais de ' + CONFIG.PRAZO_RN11_DIAS_MIN + ' dias de diferença entre o campo Data DOC e o dia de hoje: ' + DateUtil.toBR(DateUtil.hoje()));
                Logger.br(current, 'RN13 [ELSE] - Validar campo [Data DOC]');
            }
            return true;
        },

        // -------------- RN30.x --------------
        applyRN301_IdentificarInfratorEMB_TRANP: function(current) {
            return this._identificarInfrator(current, {
                label: 'EMB/TRANP',
                conds: function(c) {
                    var embarcador = c.getValue('sior_nome_do_embarcador');
                    var transportador = c.getValue('sior_nome_do_transportador');
                    var infrator = c.getValue('sior_nome_do_infrator');
                    var realInfrator = c.getValue('sior_real_infrator');
                    var destinatarioNA = c.getValue('sior_destinatario_na');
                    var destinatarioNP = c.getValue('sior_destinatario_np');
                    var proprietario = c.getValue('sior_nome_proprietario_veiculo');

                    var cond1 = (eq(embarcador, infrator) || eq(transportador, infrator)) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond2 = eq(realInfrator, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond3 = (eq(embarcador, 'Não Informado') || eq(transportador, 'Não Informado')) && eq(destinatarioNA, proprietario) && eq(destinatarioNP, proprietario);
                    return { ok: (cond1 || cond2 || cond3), tag: cond1 ? 'IF1' : (cond2 ? 'IF2' : 'IF3') };
                }
            });
        },

        applyRN302_IdentificarInfratorEmbarcador: function(current) {
            return this._identificarInfrator(current, {
                label: 'EMBARCADOR',
                conds: function(c) {
                    var embarcador = c.getValue('sior_nome_do_embarcador');
                    var infrator = c.getValue('sior_nome_do_infrator');
                    var realInfrator = c.getValue('sior_real_infrator');
                    var destinatarioNA = c.getValue('sior_destinatario_na');
                    var destinatarioNP = c.getValue('sior_destinatario_np');
                    var proprietario = c.getValue('sior_nome_proprietario_veiculo');

                    var cond1 = eq(embarcador, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond2 = eq(realInfrator, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond3 = eq(embarcador, 'Não Informado') && eq(destinatarioNA, proprietario) && eq(destinatarioNP, proprietario);
                    return { ok: (cond1 || cond2 || cond3), tag: cond1 ? 'IF1' : (cond2 ? 'IF2' : 'IF3') };
                }
            });
        },

        applyRN303_IdentificarInfratorTransportador: function(current) {
            return this._identificarInfrator(current, {
                label: 'Transportador',
                conds: function(c) {
                    var transportador = c.getValue('sior_nome_do_transportador');
                    var infrator = c.getValue('sior_nome_do_infrator');
                    var realInfrator = c.getValue('sior_real_infrator');
                    var destinatarioNA = c.getValue('sior_destinatario_na');
                    var destinatarioNP = c.getValue('sior_destinatario_np');
                    var proprietario = c.getValue('sior_nome_proprietario_veiculo');

                    var cond1 = eq(transportador, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond2 = eq(realInfrator, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond3 = eq(transportador, 'Não Informado') && eq(proprietario, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    return { ok: (cond1 || cond2 || cond3), tag: cond1 ? 'IF1' : (cond2 ? 'IF2' : 'IF3') };
                }
            });
        },

        applyRN304_IdentificarInfratorProprietario: function(current) {
            return this._identificarInfrator(current, {
                label: 'Proprietário',
                conds: function(c) {
                    var transportador = c.getValue('sior_nome_do_transportador');
                    var infrator = c.getValue('sior_nome_do_infrator');
                    var realInfrator = c.getValue('sior_real_infrator');
                    var destinatarioNA = c.getValue('sior_destinatario_na');
                    var destinatarioNP = c.getValue('sior_destinatario_np');
                    var proprietario = c.getValue('sior_nome_proprietario_veiculo');

                    var cond1 = eq(transportador, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond2 = eq(realInfrator, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    var cond3 = eq(transportador, 'Não Informado') && eq(proprietario, infrator) && eq(destinatarioNA, infrator) && eq(destinatarioNP, infrator);
                    return { ok: (cond1 || cond2 || cond3), tag: cond1 ? 'IF1' : (cond2 ? 'IF2' : 'IF3') };
                },
                stageOnFail: CONFIG.STAGES.REVISAO_SUP // compatibilidade com comentário original
            });
        },

        // --------- Helper comum para RN30.x ---------
        _identificarInfrator: function(current, cfg) {
            if (!RecordUtil.exists(current)) return false;
            var res = cfg.conds(current);
            if (res.ok) {
                RecordUtil.set(current, CONFIG.CAMPOS.RN30, true);
                Logger.br(current, 'RN30.x [' + res.tag + '] - Identificar infrator da AIT tipo "' + cfg.label + '"');
                return true;
            }
            RecordUtil.set(current, CONFIG.CAMPOS.RN30, false);
            Logger.obs(current, 'PENDENTE – Auto P – Infrator não identificado corretamente');
            RecordUtil.set(current, 'u_resultado', 'Revisão do Sapiens');
            RecordUtil.set(current, CONFIG.CAMPOS.STAGE, cfg.stageOnFail || CONFIG.STAGES.REVISAO);
            Logger.br(current, 'RN30.x [ELSE] - Identificar infrator da AIT tipo "' + cfg.label + '"');
            return false;
        },

        // =========================
        // OPERAÇÕES ATÔMICAS (compat)
        // =========================
        validarObjetoExiste: RecordUtil.exists,
        carregarAutoPorCampo: function(tabela, campo, valor) { return RecordUtil.getByField(tabela, campo, valor); },
        obterPrimeiroRegistroPorCampo: function(tabela, campo, valor) { return RecordUtil.firstBy(tabela, campo, valor); },
        definirValor: RecordUtil.set,
        atualizarRegistro: RecordUtil.update,
        anexarBusinessRuleLog: function(record, msg) { Logger.br(record, String(msg || '')); },
        anexarObservacao: function(record, msg) { Logger.obs(record, String(msg || '')); },
        definirStage: function(record, stageVal) { RecordUtil.set(record, CONFIG.CAMPOS.STAGE, stageVal); },
        valoresIguais: eq,
        dataEhAntes: DateUtil.before,
        dataEhMaiorOuIgual: DateUtil.gte,
        somarAnos: DateUtil.addAnos,
        somarDias: DateUtil.addDias,
        primeiroDiaDoMesSeguinte: DateUtil.primeiroDiaMesSeguinte,
        hoje: DateUtil.hoje,
        hojeMaisDias: function(dias) { return DateUtil.addDias(DateUtil.hoje(), dias); },
        diasEntre: DateUtil.diffDias,
        ehAteTresAnos: ateTresAnos,
        dataFormatoBR: DateUtil.toBR,

        // Mantido por compatibilidade com referências externas (se existirem)
        _getFirstBy: function(table, field, value) { return RecordUtil.firstBy(table, field, value); },

        type: 'AutoEditalUtils'
    };

    return api;
})();
