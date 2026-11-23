---
documentId: webhooks
title: Webhooks
---

# Webhooks de Aster

Solo un administrador puede configurar webhooks en Administración > Integraciones. Los eventos disponibles son incidencia.creada e incidencia.cerrada.

## Entrega

El destino debe usar HTTPS. Aster firma el cuerpo con HMAC-SHA256 usando el secreto configurado. Ante un HTTP 500 se realizan tres reintentos: después de 1, 5 y 15 minutos. No se reintenta un HTTP 400.
