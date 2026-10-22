# CMMS Analítica de Mantenimiento

Aplicación web estática que traslada al navegador los principales indicadores del notebook `Untitled0_local.ipynb`. No necesita servidor de análisis: los archivos que selecciona el usuario se leen, procesan y se convierten en gráficos y PDF dentro de su navegador.

## Ejecutar localmente

1. Abre una terminal en la carpeta `GMAO`.
2. Inicia un servidor estático sencillo:

   ```powershell
   python -m http.server 8000
   ```

3. Abre `http://localhost:8000/webapp/`.
4. Selecciona un archivo CSV, XLSX o XLS. La primera hoja de un libro Excel es la que se analiza.

La carga de archivos seleccionados también funciona sin servidor; el servidor local habilita además el botón «Probar con dataset de ejemplo».

## Publicar en GitHub Pages

Sube al repositorio la carpeta `webapp` y los archivos estáticos del proyecto que quieras publicar. En GitHub, abre **Settings → Pages**, selecciona **Deploy from a branch**, elige la rama y publica desde la carpeta raíz. Después abre `https://<usuario>.github.io/<repositorio>/webapp/`. GitHub Pages no permite elegir cualquier subcarpeta del repositorio como origen directo; si quieres que la app quede en la raíz del sitio, publica una copia de los archivos de `webapp` desde la raíz o usa un workflow de Pages.

Si el sitio se publica desde la raíz del repositorio, abre `/webapp/`. El enlace a dataset de ejemplo usa una ruta relativa (`../dataset/CMMS_grupo_B.csv`); ese botón funciona cuando la carpeta `dataset` también se publica. Si no está disponible, el usuario puede cargar su propio archivo.

## Columnas de datos

Se requieren una columna de orden de trabajo (`OT`, `Orden` o equivalente) y el tipo de mantenimiento (`Tipo_mantenimiento` o equivalente). El resto de las columnas es opcional; cuando falte una columna, la aplicación avisa y limita solo los indicadores que dependan de ella.

Se reconocen columnas de equipo, criticidad, estado, modo de falla, fecha de inicio/fin, horas de mano de obra, downtime y costo total. Los encabezados ignoran diferencias entre mayúsculas, espacios, guiones bajos y tildes. Los archivos de muestra del proyecto son compatibles.

## Indicadores

- Órdenes únicas y distribución por tipo de mantenimiento.
- Filtros por fecha de inicio inclusivos (desde/hasta), tipo de mantenimiento y tipo de equipo.
- Horas-hombre, downtime y costos directos.
- MTTR como el promedio de fecha fin menos fecha de inicio para correctivos cerrados con duración positiva.
- Pareto de modos de falla correctivos por frecuencia, downtime y costo.
- Prioridad Jack-Knife para equipos y modos de falla.
- Informe PDF ejecutivo con tablas, visualizaciones y alcance metodológico.

No se estima MTBF ni disponibilidad porque ambos indicadores requieren tiempo operacional del activo que no se obtiene únicamente de órdenes de trabajo.

## Bibliotecas externas

La aplicación usa Papa Parse, SheetJS, Chart.js y jsPDF desde jsDelivr. El análisis de los datos es local; estas bibliotecas se descargan desde CDN y se necesita conexión a internet para cargarlas. Si el CDN no está disponible, la página muestra un aviso de carga o exportación.
