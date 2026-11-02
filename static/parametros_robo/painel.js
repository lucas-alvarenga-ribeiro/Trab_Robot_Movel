/* Painel de parâmetros, trajetórias e controle manual do robô.
 *
 * Expõe window.ParametrosRobo com:
 *   obterParametros()  -> objeto com os parâmetros do formulário
 *   obterModelo()      -> chave do modelo escolhido
 *   obterSegmentos()   -> Promise com os segmentos {v, w, duracao} da trajetória escolhida
 *   simular()          -> Promise com o resultado de POST /api/robo/simular (cálculo em lote)
 *   aoSimular(fn)      -> registra callback chamado com cada resultado de simular()
 *
 * A comunicação com o motor da simulação (static/script.js) é feita por eventos:
 *   "executarTrajetoriaRobo" {segmentos}  -> executa uma trajetória
 *   "atualizarVelocidadesRobo" {v, w, rodas} -> controle manual
 *   "reiniciarRobo"                       -> emitido pelo motor ao reiniciar
 */

const modoRodas = document.getElementById("pr-modo-rodas");
const camposRobo = document.getElementById("pr-campos-robo");
const camposRodas = document.getElementById("pr-campos-rodas");

(function () {
    "use strict";

    const API = "/api/robo";
    const CAMPOS = ["diametro_roda", "distancia_rodas", "erro_raio_percentual",
                    "velocidade_max_roda", "passo_tempo"];

    const form = document.getElementById("pr-form");
    const seletorModelo = document.getElementById("pr-modelo");
    const seletorTrajetoria = document.getElementById("pr-trajetoria");
    const blocoSegmentos = document.getElementById("pr-segmentos");
    const corpoTabela = blocoSegmentos.querySelector("tbody");
    const ouvintes = [];
    let modelos = [];
    let trajetoriasPadrao = null;

    // ------------------------------------------------------------------ //
    // Leitura do formulário
    // ------------------------------------------------------------------ //
    function obterParametros() {
        const p = {};
        CAMPOS.forEach((c) => { p[c] = parseFloat(form.elements[c].value); });
        return p;
    }

    function obterModelo() {
        // Antes de /modelos responder o seletor ainda está vazio
        return seletorModelo.value || "diferencial";
    }

    function segmentosPersonalizados() {
        return Array.from(corpoTabela.rows).map((linha) => {
            const [v, w, duracao] = Array.from(linha.querySelectorAll("input"))
                .map((i) => parseFloat(i.value) || 0);
            return { v, w, duracao };
        });
    }

    async function obterSegmentos() {
        if (seletorTrajetoria.value === "personalizada") {
            return segmentosPersonalizados();
        }
        if (!trajetoriasPadrao) {
            trajetoriasPadrao = await (await fetch(`${API}/trajetorias`)).json();
        }
        return trajetoriasPadrao[seletorTrajetoria.value];
    }

    // ------------------------------------------------------------------ //
    // Interface
    // ------------------------------------------------------------------ //
    function atualizarInfoRaios() {
        const p = obterParametros();
        const r = p.diametro_roda / 2;
        const rd = r * (1 + p.erro_raio_percentual / 200);
        const re = r * (1 - p.erro_raio_percentual / 200);
        document.getElementById("pr-erro-valor").textContent = p.erro_raio_percentual.toFixed(1);
        document.getElementById("pr-raios").textContent =
            `r nominal = ${(r * 1000).toFixed(2)} mm | ` +
            `r direita = ${(rd * 1000).toFixed(2)} mm | r esquerda = ${(re * 1000).toFixed(2)} mm`;
    }

    function atualizarDescricaoModelo() {
        const m = modelos.find((x) => x.chave === obterModelo());
        document.getElementById("pr-modelo-descricao").textContent = m ? m.descricao : "";
    }

    function adicionarSegmento(v = 0.3, w = 0, duracao = 2) {
        const linha = corpoTabela.insertRow();
        [v, w, duracao].forEach((valor) => {
            linha.insertCell().innerHTML = `<input type="number" step="0.01" value="${valor}">`;
        });
        const botao = document.createElement("button");
        botao.type = "button";
        botao.textContent = "✕";
        botao.onclick = () => linha.remove();
        linha.insertCell().appendChild(botao);
    }

    // ------------------------------------------------------------------ //
    // API
    // ------------------------------------------------------------------ //
    async function simular() {
        const resposta = await fetch(`${API}/simular`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                parametros: obterParametros(),
                modelo: obterModelo(),
                segmentos: await obterSegmentos(),
            }),
        });
        const resultado = await resposta.json();
        if (!resposta.ok) throw new Error(resultado.erro || "Falha na simulação");
        ouvintes.forEach((fn) => fn(resultado));
        return resultado;
    }

    async function carregarModelos() {
        modelos = await (await fetch(`${API}/modelos`)).json();
        seletorModelo.innerHTML = modelos
            .map((m) => `<option value="${m.chave}">${m.nome}</option>`).join("");
        atualizarDescricaoModelo();
    }

    // ------------------------------------------------------------------ //
    // Eventos
    // ------------------------------------------------------------------ //
    form.addEventListener("input", atualizarInfoRaios);
    seletorModelo.addEventListener("change", atualizarDescricaoModelo);
    seletorTrajetoria.addEventListener("change", () => {
        blocoSegmentos.hidden = seletorTrajetoria.value !== "personalizada";
    });
    document.getElementById("pr-add-segmento").addEventListener("click", () => adicionarSegmento());
    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const segmentos = await obterSegmentos();
        window.dispatchEvent(new CustomEvent("executarTrajetoriaRobo", {
            detail: { segmentos: segmentos },
        }));
    });

    adicionarSegmento(0.3, 0, 3);
    adicionarSegmento(0.2, 0.5, 4);
    atualizarInfoRaios();
    carregarModelos();

    window.ParametrosRobo = {
        obterParametros,
        obterModelo,
        obterSegmentos,
        simular,
        aoSimular: (fn) => ouvintes.push(fn),
    };
})();


modoRodas.addEventListener("change", () => {
    camposRobo.hidden = modoRodas.checked;
    camposRodas.hidden = !modoRodas.checked;

    // Limpa somente o histórico dos gráficos
    historicoGraficos[0] = [];
    historicoGraficos[1] = [];

    atualizarTitulosGraficos();
    atualizarVelocidadesCalculadas();
    desenharGraficos();
});

function atualizarVelocidadesCalculadas() {
    const modoRodas = document.getElementById("pr-modo-rodas").checked;

    const raio = Number(
        document.querySelector('[name="diametro_roda"]').value
    ) / 2;

    const distancia = Number(
        document.querySelector('[name="distancia_rodas"]').value
    );

    let v, w, omegaE, omegaD;

    if (raio <= 0 || distancia <= 0) return;

    if (modoRodas) {
        // Entradas: velocidades das rodas
        omegaE = Number(
            document.getElementById("pr-velocidade-roda-esquerda").value
        );

        omegaD = Number(
            document.getElementById("pr-velocidade-roda-direita").value
        );

        // Calcula as velocidades do robô
        v = raio * (omegaD + omegaE) / 2;
        w = raio * (omegaD - omegaE) / distancia;

        document.getElementById("pr-label-linear").textContent = v.toFixed(2);
        document.getElementById("pr-label-angular").textContent = w.toFixed(2);

    } else {
        // Entradas: velocidades do robô
        v = Number(
            document.getElementById("pr-velocidade-linear").value
        );

        w = Number(
            document.getElementById("pr-velocidade-angular").value
        );

        // Calcula as velocidades das rodas
        omegaE = (v - w * distancia / 2) / raio;
        omegaD = (v + w * distancia / 2) / raio;

        document.getElementById("pr-label-roda-esquerda").textContent =
            omegaE.toFixed(2);

        document.getElementById("pr-label-roda-direita").textContent =
            omegaD.toFixed(2);
    }
}

// Atualiza os valores calculados ao alterar qualquer entrada
[
    "pr-velocidade-linear",
    "pr-velocidade-angular",
    "pr-velocidade-roda-esquerda",
    "pr-velocidade-roda-direita"
].forEach((id) => {
    document.getElementById(id).addEventListener(
        "input",
        atualizarVelocidadesCalculadas
    );
});

// Atualiza ao mudar os parâmetros geométricos
[
    "diametro_roda",
    "distancia_rodas"
].forEach((nome) => {
    document.querySelector(`[name="${nome}"]`).addEventListener(
        "input",
        atualizarVelocidadesCalculadas
    );
});

// Aplica as velocidades
document.getElementById("pr-aplicar-velocidades")
    .addEventListener("click", () => {

        let v;
        let w;
        let rodas = null;

        if (modoRodas.checked) {
            // Velocidades angulares das rodas (rad/s)
            const omegaE = Number(
                document.getElementById(
                    "pr-velocidade-roda-esquerda"
                ).value
            );

            const omegaD = Number(
                document.getElementById(
                    "pr-velocidade-roda-direita"
                ).value
            );

            // Parâmetros geométricos do robô
            const diametro = Number(
                document.querySelector(
                    '[name="diametro_roda"]'
                ).value
            );

            const distancia = Number(
                document.querySelector(
                    '[name="distancia_rodas"]'
                ).value
            );

            const raio = diametro / 2;

            // Cinemática diferencial
            v = raio * (omegaD + omegaE) / 2;
            w = raio * (omegaD - omegaE) / distancia;

            // Envia também as velocidades das rodas, para que o simulador
            // as use diretamente (com o erro de raio aplicado)
            rodas = { w_d: omegaD, w_e: omegaE };

        } else {
            // Controle direto do robô
            v = Number(
                document.getElementById(
                    "pr-velocidade-linear"
                ).value
            );

            w = Number(
                document.getElementById(
                    "pr-velocidade-angular"
                ).value
            );
        }

        window.dispatchEvent(
            new CustomEvent("atualizarVelocidadesRobo", {
                detail: { v: v, w: w, rodas: rodas }
            })
        );
    });


const canvasGrafico1 = document.getElementById("pr-grafico-1");
const canvasGrafico2 = document.getElementById("pr-grafico-2");

const ctxGrafico1 = canvasGrafico1.getContext("2d");
const ctxGrafico2 = canvasGrafico2.getContext("2d");

// Histórico das duas variáveis exibidas
const historicoGraficos = [[], []];

const intervaloGrafico = 0.1; // 100 ms
const maxPontosGrafico = 120; // 12 segundos de histórico

function atualizarTitulosGraficos() {
    const titulo1 = document.getElementById("pr-titulo-grafico-1");
    const titulo2 = document.getElementById("pr-titulo-grafico-2");

    if (modoRodas.checked) {
        titulo1.textContent = "Velocidade linear do robô v (m/s)";
        titulo2.textContent = "Velocidade angular do robô ω (rad/s)";
    } else {
        titulo1.textContent = "Velocidade angular da roda esquerda ωE (rad/s)";
        titulo2.textContent = "Velocidade angular da roda direita ωD (rad/s)";
    }
}


function desenharGrafico(ctx, canvas, valores) {
    const largura = canvas.width;
    const altura = canvas.height;

    const margemEsquerda = 48;
    const margemDireita = 12;
    const margemSuperior = 15;
    const margemInferior = 28;

    const areaLargura = largura - margemEsquerda - margemDireita;
    const areaAltura = altura - margemSuperior - margemInferior;

    ctx.clearRect(0, 0, largura, altura);

    // Fundo
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);

    // Escala vertical simétrica para permitir valores negativos
    const maiorValor = Math.max(
        0.1,
        ...valores.map(valor => Math.abs(valor))
    ) * 1.1;

    const centroY = margemSuperior + areaAltura / 2;

    // Eixos
    ctx.strokeStyle = "#aaaaaa";
    ctx.lineWidth = 1;
    ctx.beginPath();

    ctx.moveTo(margemEsquerda, margemSuperior);
    ctx.lineTo(margemEsquerda, altura - margemInferior);

    ctx.moveTo(margemEsquerda, centroY);
    ctx.lineTo(largura - margemDireita, centroY);

    ctx.stroke();

    // Valores do eixo vertical
    ctx.fillStyle = "#333333";
    ctx.font = "11px Arial";
    ctx.textAlign = "right";

    ctx.fillText(
        maiorValor.toFixed(2),
        margemEsquerda - 5,
        margemSuperior + 5
    );

    ctx.fillText(
        "0",
        margemEsquerda - 5,
        centroY + 4
    );

    ctx.fillText(
        (-maiorValor).toFixed(2),
        margemEsquerda - 5,
        altura - margemInferior
    );

    // Eixo horizontal: tempo
    ctx.textAlign = "left";
    ctx.fillText("0 s", margemEsquerda, altura - 8);

    const tempoExibido = Math.max(
        0,
        (valores.length - 1) * intervaloGrafico
    );

    ctx.textAlign = "right";
    ctx.fillText(
        `${tempoExibido.toFixed(1)} s`,
        largura - margemDireita,
        altura - 8
    );

    // Curva de velocidade
    if (valores.length === 0) {
        return;
    }

    ctx.strokeStyle = "#1769aa";
    ctx.lineWidth = 2;
    ctx.beginPath();

    valores.forEach((valor, indice) => {
        const x = valores.length === 1
            ? margemEsquerda
            : margemEsquerda +
              (indice / (valores.length - 1)) * areaLargura;

        const y = centroY - (valor / maiorValor) * (areaAltura / 2);

        if (indice === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}

function desenharGraficos() {
    desenharGrafico(
        ctxGrafico1,
        canvasGrafico1,
        historicoGraficos[0]
    );

    desenharGrafico(
        ctxGrafico2,
        canvasGrafico2,
        historicoGraficos[1]
    );
}

function registrarPontoGraficos() {
    const valores = obterValoresGraficos();

    valores.forEach((valor, indice) => {
        const historico = historicoGraficos[indice];

        historico.push(Number.isFinite(valor) ? valor : 0);

        if (historico.length > maxPontosGrafico) {
            historico.shift();
        }
    });

    desenharGraficos();
}

window.addEventListener("atualizarGraficosRobo", (evento) => {

    const v = evento.detail.v;
    const w = evento.detail.w;

    const raio =
        Number(document.querySelector('[name="diametro_roda"]').value) / 2;

    const distancia =
        Number(document.querySelector('[name="distancia_rodas"]').value);

    if (raio <= 0 || distancia <= 0) {
        return;
    }

    let valor1;
    let valor2;

    if (modoRodas.checked) {

        // Usuário controla as rodas.
        // Os gráficos mostram as velocidades do robô.
        valor1 = v;
        valor2 = w;

    } else {

        // Usuário controla v e w.
        // Os gráficos mostram as velocidades das rodas.
        valor1 = (v - w * distancia / 2) / raio;
        valor2 = (v + w * distancia / 2) / raio;
    }

    historicoGraficos[0].push(valor1);
    historicoGraficos[1].push(valor2);

    if (historicoGraficos[0].length > maxPontosGrafico) {
        historicoGraficos[0].shift();
    }

    if (historicoGraficos[1].length > maxPontosGrafico) {
        historicoGraficos[1].shift();
    }

    desenharGraficos();
});

// Reiniciar a simulação também limpa os gráficos
window.addEventListener("reiniciarRobo", () => {
    historicoGraficos[0] = [];
    historicoGraficos[1] = [];
    desenharGraficos();
});

// Configuração inicial
atualizarTitulosGraficos();
desenharGraficos();
