"""Parâmetros físicos do robô diferencial.

Toda medida de comprimento está em metros, ângulos em radianos e tempo em
segundos. O erro entre os raios das rodas é aplicado de forma simétrica:

    r_direita_real = r_nominal * (1 + erro/2)
    r_esquerda_real = r_nominal * (1 - erro/2)

de modo que a média dos raios continua igual ao raio nominal e a razão
r_direita / r_esquerda reflete a diferença pedida pelo usuário.
"""

from dataclasses import dataclass, asdict, fields


@dataclass
class ParametrosRobo:
    diametro_roda: float = 0.195          # Pioneer 3-DX: 195 mm
    distancia_rodas: float = 0.381        # bitola (distância entre as rodas)
    erro_raio_percentual: float = 0.0     # diferença relativa entre os raios (%)
    velocidade_max_roda: float = 12.0     # rad/s, saturação de cada roda
    passo_tempo: float = 0.01             # dt da integração

    def __post_init__(self):
        self.validar()

    # ------------------------------------------------------------------ #
    # Validação
    # ------------------------------------------------------------------ #
    def validar(self):
        if self.diametro_roda <= 0:
            raise ValueError("O diâmetro da roda deve ser positivo.")
        if self.distancia_rodas <= 0:
            raise ValueError("A distância entre as rodas deve ser positiva.")
        if abs(self.erro_raio_percentual) >= 100:
            raise ValueError("O erro entre os raios deve estar entre -100% e 100%.")
        if self.velocidade_max_roda <= 0:
            raise ValueError("A velocidade máxima da roda deve ser positiva.")
        if not 0 < self.passo_tempo <= 1:
            raise ValueError("O passo de tempo deve estar em (0, 1] s.")

    # ------------------------------------------------------------------ #
    # Grandezas derivadas
    # ------------------------------------------------------------------ #
    @property
    def raio_nominal(self):
        return self.diametro_roda / 2

    @property
    def raio_direita(self):
        """Raio real da roda direita, considerando o erro simulado."""
        return self.raio_nominal * (1 + self.erro_raio_percentual / 200)

    @property
    def raio_esquerda(self):
        """Raio real da roda esquerda, considerando o erro simulado."""
        return self.raio_nominal * (1 - self.erro_raio_percentual / 200)

    # ------------------------------------------------------------------ #
    # Conversão
    # ------------------------------------------------------------------ #
    def para_dict(self):
        dados = asdict(self)
        dados.update(
            raio_nominal=self.raio_nominal,
            raio_direita=self.raio_direita,
            raio_esquerda=self.raio_esquerda,
        )
        return dados

    @classmethod
    def de_dict(cls, dados):
        """Cria a partir de um dicionário, ignorando chaves desconhecidas."""
        nomes = {f.name for f in fields(cls)}
        return cls(**{k: float(v) for k, v in (dados or {}).items() if k in nomes})
