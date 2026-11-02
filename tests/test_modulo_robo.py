"""Testes do módulo de parâmetros e modelos do robô.

Executar a partir da raiz do projeto:  python -m unittest discover tests
"""

import math
import unittest

from modulo_robo import ParametrosRobo, Robo, trajetoria_padrao
from modulo_robo.modelos import MODELOS


class TestParametros(unittest.TestCase):
    def test_raios_com_erro(self):
        p = ParametrosRobo(diametro_roda=0.2, erro_raio_percentual=2.0)
        self.assertAlmostEqual(p.raio_nominal, 0.1)
        self.assertAlmostEqual(p.raio_direita, 0.101)
        self.assertAlmostEqual(p.raio_esquerda, 0.099)
        self.assertAlmostEqual((p.raio_direita + p.raio_esquerda) / 2, p.raio_nominal)

    def test_validacao(self):
        with self.assertRaises(ValueError):
            ParametrosRobo(diametro_roda=0)
        with self.assertRaises(ValueError):
            ParametrosRobo(distancia_rodas=-1)
        with self.assertRaises(ValueError):
            ParametrosRobo(erro_raio_percentual=150)

    def test_de_dict_ignora_chaves_desconhecidas(self):
        p = ParametrosRobo.de_dict({"diametro_roda": "0.3", "outra": 1})
        self.assertAlmostEqual(p.diametro_roda, 0.3)


class TestModelos(unittest.TestCase):
    def test_reta(self):
        for modelo in MODELOS.values():
            x, y, th = modelo.atualizar((0, 0, 0), 10, 10, 0.1, 0.1, 0.4, 1.0)
            self.assertAlmostEqual(x, 1.0, msg=modelo.chave)
            self.assertAlmostEqual(y, 0.0)
            self.assertAlmostEqual(th, 0.0)

    def test_giro_no_lugar(self):
        for modelo in MODELOS.values():
            x, y, th = modelo.atualizar((0, 0, 0), 1, -1, 0.1, 0.1, 0.4, 1.0)
            self.assertAlmostEqual(x, 0.0)
            self.assertAlmostEqual(y, 0.0)
            self.assertAlmostEqual(th, 0.5)

    def test_incremental_converge_para_diferencial(self):
        p = ParametrosRobo(passo_tempo=0.001)
        finais = {}
        for chave in MODELOS:
            robo = Robo(p, modelo=chave)
            finais[chave] = robo.simular(trajetoria_padrao("circulo"))["amostras"][-1]["real"]
        a, b = finais["diferencial"], finais["incremental"]
        self.assertLess(math.hypot(a[0] - b[0], a[1] - b[1]), 1e-3)


class TestSimulador(unittest.TestCase):
    def test_sem_erro_real_igual_odometria(self):
        r = Robo(ParametrosRobo(), "diferencial").simular(trajetoria_padrao("quadrado"))
        self.assertAlmostEqual(r["erro_final"]["posicao"], 0.0)

    def test_quadrado_fecha_sem_erro(self):
        r = Robo(ParametrosRobo(passo_tempo=0.001)).simular(trajetoria_padrao("quadrado"))
        x, y, _ = r["amostras"][-1]["real"]
        self.assertLess(math.hypot(x, y), 0.01)

    def test_erro_de_raio_gera_deriva(self):
        r = Robo(ParametrosRobo(erro_raio_percentual=2.0)).simular(trajetoria_padrao("reta"))
        x, y, th = r["amostras"][-1]["real"]
        self.assertGreater(y, 0)   # roda direita maior -> desvia para a esquerda
        self.assertGreater(th, 0)
        self.assertGreater(r["erro_final"]["posicao"], 0.01)

    def test_saturacao_preserva_curvatura(self):
        robo = Robo(ParametrosRobo(velocidade_max_roda=5))
        w_d, w_e = robo.velocidades_rodas(2.0, 1.0)
        self.assertAlmostEqual(max(abs(w_d), abs(w_e)), 5)
        L = robo.parametros.distancia_rodas
        self.assertAlmostEqual(w_d / w_e, (2.0 + L / 2) / (2.0 - L / 2))


class TestApi(unittest.TestCase):
    def setUp(self):
        from app import app
        self.cliente = app.test_client()

    def test_simular(self):
        resp = self.cliente.post("/api/robo/simular", json={
            "parametros": {"diametro_roda": 0.2, "erro_raio_percentual": 1},
            "modelo": "incremental",
            "segmentos": [{"v": 0.3, "w": 0, "duracao": 2}],
        })
        self.assertEqual(resp.status_code, 200)
        dados = resp.get_json()
        self.assertEqual(dados["modelo"], "incremental")
        self.assertGreater(len(dados["amostras"]), 1)

    def test_parametro_invalido(self):
        resp = self.cliente.post("/api/robo/simular", json={"parametros": {"diametro_roda": -1}})
        self.assertEqual(resp.status_code, 400)

    def test_passo_tempo_real(self):
        resp = self.cliente.post("/api/robo/passo", json={
            "parametros": {"erro_raio_percentual": 2},
            "modelo": "incremental",
            "pose_real": [0, 0, 0], "pose_odometria": [0, 0, 0],
            "v": 0.3, "w": 0, "dt": 1.0,
        })
        self.assertEqual(resp.status_code, 200)
        dados = resp.get_json()
        self.assertAlmostEqual(dados["real"][0], 0.3, places=2)
        self.assertGreater(dados["real"][2], 0)          # erro de raio faz o robô girar
        self.assertAlmostEqual(dados["odometria"][2], 0)  # a odometria não percebe
        # 100 subpassos -> no máximo 50 amostras, a última igual ao estado final
        self.assertLessEqual(len(dados["amostras"]), 50)
        self.assertEqual(dados["amostras"][-1]["real"], dados["real"])
        self.assertAlmostEqual(dados["amostras"][-1]["t"], 1.0)

    def test_passo_com_velocidades_das_rodas(self):
        resp = self.cliente.post("/api/robo/passo", json={"w_d": 2, "w_e": -2, "dt": 0.5})
        dados = resp.get_json()
        self.assertEqual((dados["w_d"], dados["w_e"]), (2, -2))
        self.assertAlmostEqual(dados["real"][0], 0)
        self.assertGreater(dados["real"][2], 0)

    def test_pagina_inicial(self):
        self.assertIn(b"pr-painel", self.cliente.get("/").data)


if __name__ == "__main__":
    unittest.main()
