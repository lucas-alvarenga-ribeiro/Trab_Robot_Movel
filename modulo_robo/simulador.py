"""Simulador do robô diferencial.

O robô mantém duas poses:

* pose_real: movimento verdadeiro, calculado com os raios REAIS das rodas
  (incluindo o erro simulado entre elas);
* pose_odometria: o que o robô "acha" que fez, calculado com o raio NOMINAL
  a partir das mesmas rotações das rodas (como faria com os encoders).

Com erro zero as duas trajetórias coincidem; com erro, a diferença entre elas
mostra a deriva da odometria.
"""

import math

from .modelos import obter_modelo
from .parametros import ParametrosRobo


class Robo:
    def __init__(self, parametros=None, modelo="diferencial", pose_inicial=(0.0, 0.0, 0.0)):
        self.parametros = parametros or ParametrosRobo()
        self.modelo = obter_modelo(modelo)
        self.tempo = 0.0
        self.pose_real = tuple(pose_inicial)
        self.pose_odometria = tuple(pose_inicial)

    # ------------------------------------------------------------------ #
    # Comandos
    # ------------------------------------------------------------------ #
    def velocidades_rodas(self, v, w):
        """Converte (v, ω) desejados em velocidades das rodas (rad/s).

        O controlador só conhece o raio nominal, por isso o erro de raio não
        é compensado. As velocidades são saturadas preservando a razão entre
        as rodas (mantém a curvatura pedida).
        """
        p = self.parametros
        w_d = (v + w * p.distancia_rodas / 2) / p.raio_nominal
        w_e = (v - w * p.distancia_rodas / 2) / p.raio_nominal

        maior = max(abs(w_d), abs(w_e))
        if maior > p.velocidade_max_roda:
            escala = p.velocidade_max_roda / maior
            w_d *= escala
            w_e *= escala
        return w_d, w_e

    def passo(self, w_d, w_e, dt=None):
        """Avança um passo de tempo com as velocidades das rodas dadas."""
        p = self.parametros
        dt = dt or p.passo_tempo
        L = p.distancia_rodas
        self.pose_real = self.modelo.atualizar(
            self.pose_real, w_d, w_e, p.raio_direita, p.raio_esquerda, L, dt)
        self.pose_odometria = self.modelo.atualizar(
            self.pose_odometria, w_d, w_e, p.raio_nominal, p.raio_nominal, L, dt)
        self.tempo += dt
        return self.estado()

    def estado(self):
        return {
            "t": round(self.tempo, 6),
            "real": list(self.pose_real),
            "odometria": list(self.pose_odometria),
        }

    # ------------------------------------------------------------------ #
    # Simulação completa
    # ------------------------------------------------------------------ #
    def simular(self, segmentos, max_pontos=2000):
        """Executa uma lista de segmentos {v, w, duracao}.

        Retorna as amostras da trajetória (limitadas a ~max_pontos) e o erro
        final entre a pose real e a estimada pela odometria.
        """
        dt = self.parametros.passo_tempo
        passos_por_segmento = [max(1, round(float(s["duracao"]) / dt)) for s in segmentos]
        total = sum(passos_por_segmento)
        if total > 1_000_000:
            raise ValueError("Simulação muito longa: reduza a duração ou aumente o passo de tempo.")
        intervalo = max(1, total // max_pontos)

        amostras = [self.estado()]
        contador = 0
        for segmento, n in zip(segmentos, passos_por_segmento):
            w_d, w_e = self.velocidades_rodas(float(segmento["v"]), float(segmento["w"]))
            for _ in range(n):
                self.passo(w_d, w_e, dt)
                contador += 1
                if contador % intervalo == 0:
                    amostras.append(self.estado())
        if contador % intervalo:
            amostras.append(self.estado())

        return {
            "modelo": self.modelo.chave,
            "parametros": self.parametros.para_dict(),
            "amostras": amostras,
            "erro_final": self.erro_odometria(),
        }

    def erro_odometria(self):
        xr, yr, tr = self.pose_real
        xo, yo, to = self.pose_odometria
        return {
            "posicao": math.hypot(xr - xo, yr - yo),
            "orientacao": math.atan2(math.sin(tr - to), math.cos(tr - to)),
        }


# ---------------------------------------------------------------------- #
# Trajetórias pré-definidas
# ---------------------------------------------------------------------- #
def trajetoria_padrao(nome, v=0.3, lado=2.0, raio=1.0):
    """Gera segmentos {v, w, duracao} para trajetórias de teste."""
    if nome == "reta":
        return [{"v": v, "w": 0.0, "duracao": lado / v}]
    if nome == "circulo":
        return [{"v": v, "w": v / raio, "duracao": 2 * math.pi * raio / v}]
    if nome == "quadrado":  # teste tipo UMBmark: 4 lados + 4 giros de 90°
        w_giro = 0.5
        lado_seg = {"v": v, "w": 0.0, "duracao": lado / v}
        giro_seg = {"v": 0.0, "w": w_giro, "duracao": (math.pi / 2) / w_giro}
        return [lado_seg, giro_seg] * 4
    raise ValueError(f"Trajetória desconhecida: {nome!r}")


TRAJETORIAS = ["reta", "circulo", "quadrado"]
