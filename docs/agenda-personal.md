# Tu agenda personal

## Compartí tu primera reunión

1. Entrá con Google y abrí **Disponibilidad**. Revisá los días, los rangos y la zona horaria del horario predeterminado. Podés agregar excepciones para vacaciones o días con otro horario.
2. En **Eventos**, elegí **Crear reunión de 30 minutos**. Se publica un evento individual con tu horario predeterminado y la ubicación a definir. Con **Editar** podés cambiar la duración, la ubicación o el aviso mínimo. Para configurar todo antes de publicar, elegí **Nuevo evento**.
3. Copiá el enlace del evento. El enlace de tu perfil muestra todos tus tipos de evento activos y visibles. Un evento oculto se puede compartir con su enlace directo.
4. El invitado abre el enlace, elige un horario y completa sus datos. La página de confirmación le permite reprogramar o cancelar. Vos podés consultar la reunión desde **Reservas**.

Para compartir con otras personas por internet, usá el dominio público de tu instalación. La configuración con Cloudflare Tunnel está en el [README](../README.md#2a-publicarlo-con-cloudflare-tunnel).

## Bloqueá los feriados argentinos

En **Disponibilidad**, elegí el horario que querés modificar y abrí **Buscar feriados argentinos** en **Excepciones por fecha**. Elegí el año y buscá por nombre o fecha. Marcá los días que te interesan, hacé clic en **Bloquear fechas** y después en **Guardar horario**. Así se cierran esos días completos para las nuevas reservas y reprogramaciones de ese horario, en su zona horaria.

Para llevar las fechas a otro calendario, usá **Exportar .ics**. El archivo contiene los feriados seleccionados como eventos de día completo que figuran como ocupados. Los datos provienen de [ArgentinaDatos](https://argentinadatos.com).

## Elegí cómo se reserva

| Si querés ofrecer… | Elegí |
| --- | --- |
| Una reunión por turno con horarios recurrentes | **Nuevo evento**, modalidad **Uno a uno**. |
| Una clase o un taller | **Grupal**. Cada persona, incluidos los acompañantes, ocupa un lugar. El turno sigue disponible mientras queden lugares y cuenta como una reunión para los topes. |
| Una reunión en fechas puntuales | **Reunión única**. Proponé fechas y horas. La primera reserva cierra todas las opciones. Si se cancela, las opciones futuras vuelven a estar disponibles. |
| Una invitación que se pueda usar una sola vez | En un evento activo individual o grupal, elegí **Link de un solo uso**. Ese enlace se consume al confirmar la reserva y sigue consumido si se cancela. |

En el editor podés pedir respuestas de texto, teléfono, opción única, varias opciones o desplegable. Elegí qué preguntas son obligatorias y si el invitado puede sumar acompañantes. También podés fijar la zona horaria e incluir enlaces en la confirmación o redirigir al invitado a tu web.

## Cupos, márgenes y calendarios

Los límites por tipo se configuran en **Eventos**. Para definir cuántas reuniones aceptás entre todos los tipos, usá **Disponibilidad → Límites de reuniones**. Podés combinar límites por día, semana y mes y dejar en blanco los períodos sin tope.

En **Integraciones** conectá Google Calendar. Elegí qué calendarios bloquean tus turnos y en cuál se crean las reservas. Podés activar la sincronización para que los cambios de horario y las cancelaciones que hagas en Google se reflejen en la agenda. La aplicación revisa los cambios cada cinco minutos. La opción de mostrar los márgenes crea bloques en Google para las reuniones individuales y únicas.

## Correos

Con SMTP configurado, la aplicación envía confirmaciones y cambios de reserva. En el editor de cada evento podés elegir hasta tres recordatorios y un mensaje de seguimiento. El servidor revisa cada minuto qué mensajes corresponde enviar. La invitación de Google Calendar se gestiona al conectar la cuenta y elegir el calendario de destino.
