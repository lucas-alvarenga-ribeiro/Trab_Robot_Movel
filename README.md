# Trab_Robot_Movel

## Módulo de parâmetros e modelos do robô (`modulo_robo`)

Permite alterar os parâmetros do robô, simular erro entre os raios das rodas e
escolher entre o **modelo diferencial** e o **modelo cinemático incremental**.

### Estrutura

| Arquivo | Conteúdo |
|---|---|
| `modulo_robo/parametros.py` | `ParametrosRobo`: diâmetro das rodas, distância entre elas, erro entre os raios (%), velocidade máx., dt |
| `modulo_robo/modelos.py` | `ModeloDiferencial` e `ModeloIncremental` (mesma interface `atualizar`) + registro `MODELOS` |
| `modulo_robo/simulador.py` | `Robo`: pose real (raios com erro) × pose de odometria (raio nominal); trajetórias prontas |
| `modulo_robo/rotas.py` | Blueprint Flask `/api/robo/...` |
| `templates/parametros_robo/painel.html` | Painel da interface (incluível em qualquer página) |
| `static/parametros_robo/` | CSS (classes com prefixo `pr-`) e JS (`window.ParametrosRobo`) |
| `tests/test_modulo_robo.py` | Testes (`python -m unittest discover tests`) |

### Integração (já feita em `app.py` e `index.html`)

```python
from modulo_robo import robo_bp
app.register_blueprint(robo_bp)
```

```html
{% include "parametros_robo/painel.html" %}
```

### Erro entre os raios

Aplicado de forma simétrica: `r_dir = r(1 + e/2)`, `r_esq = r(1 - e/2)`.
O robô comanda as rodas e calcula a odometria com o raio nominal, então a
trajetória real se afasta da estimada — o painel mostra as duas e o erro final.

### API

- `GET /api/robo/parametros` – valores padrão
- `GET /api/robo/modelos` – modelos disponíveis
- `POST /api/robo/simular` – `{"parametros": {...}, "modelo": "diferencial"|"incremental", "trajetoria": "quadrado"|"circulo"|"reta"}` ou `"segmentos": [{"v", "w", "duracao"}]`

Uso direto em Python (ex.: para outra parte do simulador):

```python
from modulo_robo import ParametrosRobo, Robo
robo = Robo(ParametrosRobo(erro_raio_percentual=1.5), modelo="incremental")
w_d, w_e = robo.velocidades_rodas(v=0.3, w=0.2)
robo.passo(w_d, w_e)          # -> {"t", "real": [x, y, θ], "odometria": [x, y, θ]}
```
