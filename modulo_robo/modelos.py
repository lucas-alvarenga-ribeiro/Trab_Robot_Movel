"""Modelos de movimento do robô diferencial.

Todos os modelos seguem a mesma interface:

    novo_x, novo_y, novo_theta = modelo.atualizar(pose, w_d, w_e, r_d, r_e, L, dt)

onde (w_d, w_e) são as velocidades angulares das rodas direita/esquerda (rad/s),
(r_d, r_e) os raios usados no cálculo e L a distância entre as rodas.

Para acrescentar um novo modelo basta criar uma subclasse de ModeloCinematico
e registrá-la em MODELOS.
"""

import math


def normalizar_angulo(theta):
    """Mantém o ângulo no intervalo (-pi, pi]."""
    return math.atan2(math.sin(theta), math.cos(theta))


class ModeloCinematico:
    chave = ""
    nome = ""
    descricao = ""

    def atualizar(self, pose, w_d, w_e, r_d, r_e, L, dt):
        raise NotImplementedError


class ModeloDiferencial(ModeloCinematico):
    """Modelo diferencial contínuo.

    v = (r_d*w_d + r_e*w_e) / 2,   w = (r_d*w_d - r_e*w_e) / L
    x' = v cos(theta),  y' = v sin(theta),  theta' = w

    A equação é integrada de forma exata assumindo v e w constantes durante dt
    (movimento em arco de circunferência).
    """

    chave = "diferencial"
    nome = "Modelo diferencial"
    descricao = "Integra x' = v cosθ, y' = v sinθ, θ' = ω de forma exata (arco de circunferência)."

    def atualizar(self, pose, w_d, w_e, r_d, r_e, L, dt):
        x, y, theta = pose
        v = (r_d * w_d + r_e * w_e) / 2
        w = (r_d * w_d - r_e * w_e) / L

        if abs(w) < 1e-9:  # movimento retilíneo
            x += v * math.cos(theta) * dt
            y += v * math.sin(theta) * dt
        else:
            novo_theta = theta + w * dt
            raio = v / w
            x += raio * (math.sin(novo_theta) - math.sin(theta))
            y -= raio * (math.cos(novo_theta) - math.cos(theta))
        theta += w * dt
        return x, y, normalizar_angulo(theta)


class ModeloIncremental(ModeloCinematico):
    """Modelo cinemático incremental (odometria por encoders).

    Δs_d = r_d Δφ_d,  Δs_e = r_e Δφ_e
    Δs = (Δs_d + Δs_e) / 2,  Δθ = (Δs_d - Δs_e) / L
    x += Δs cos(θ + Δθ/2),  y += Δs sin(θ + Δθ/2),  θ += Δθ
    """

    chave = "incremental"
    nome = "Modelo cinemático incremental"
    descricao = "Usa os deslocamentos Δs das rodas a cada passo com aproximação do ponto médio (θ + Δθ/2)."

    def atualizar(self, pose, w_d, w_e, r_d, r_e, L, dt):
        x, y, theta = pose
        ds_d = r_d * w_d * dt
        ds_e = r_e * w_e * dt
        ds = (ds_d + ds_e) / 2
        dtheta = (ds_d - ds_e) / L

        x += ds * math.cos(theta + dtheta / 2)
        y += ds * math.sin(theta + dtheta / 2)
        theta += dtheta
        return x, y, normalizar_angulo(theta)


MODELOS = {m.chave: m for m in (ModeloDiferencial(), ModeloIncremental())}


def obter_modelo(chave):
    try:
        return MODELOS[chave]
    except KeyError:
        raise ValueError(f"Modelo desconhecido: {chave!r}. Opções: {list(MODELOS)}")


def listar_modelos():
    return [{"chave": m.chave, "nome": m.nome, "descricao": m.descricao} for m in MODELOS.values()]
