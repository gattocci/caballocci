import type { Row } from './types'

export function seedDatabase(save: (input: Row) => unknown) {
  const base = new Date(); base.setHours(10, 0, 0, 0)
  const at = (offset: number, hour: number) => { const date = new Date(base); date.setDate(date.getDate() + offset); date.setHours(hour); return date.toISOString() }
  const samples = [
    { title:'CÃ³mo planeamos un mes en 30 min', caption:'Un sistema simple vence a una semana caÃ³tica. Guarda este proceso para tu prÃ³xima sesiÃ³n de contenido.', hashtags:['#ContentPlanning','#CreatorTips'], platforms:['instagram'], contentType:'reel', status:'scheduled', scheduledAt:at(0,11), durationMinutes:45, project:'Marca personal', color:'#ef6548' },
    { title:'DetrÃ¡s de campaÃ±a Aurora', caption:'Del primer boceto al resultado final. Este es el trabajo que normalmente no se ve.', hashtags:['#BehindTheScenes'], platforms:['instagram','facebook'], contentType:'carousel', status:'approved', scheduledAt:at(1,15), durationMinutes:60, project:'CampaÃ±a Aurora', color:'#35a780' },
    { title:'Hilo: 5 aprendizajes del trimestre', caption:'Cinco decisiones pequeÃ±as que cambiaron nuestros resultados este trimestre.', hashtags:['#Marketing'], platforms:['x'], contentType:'thread', status:'draft', scheduledAt:at(2,9), durationMinutes:30, project:'Editorial', color:'#4b8ed8' },
    { title:'Pregunta a la comunidad', caption:'Â¿QuÃ© parte de crear contenido te consume mÃ¡s tiempo?', hashtags:['#Community'], platforms:['facebook','x'], contentType:'post', status:'review', scheduledAt:at(3,18), durationMinutes:30, project:'Comunidad', color:'#e5ac39' },
    { title:'Lanzamiento: plantilla semanal', caption:'La plantilla que usamos cada lunes ya estÃ¡ disponible.', hashtags:['#ProductLaunch','#Templates'], platforms:['instagram','facebook','x'], contentType:'carousel', status:'idea', scheduledAt:at(5,12), durationMinutes:60, project:'Producto', color:'#9a72d8' },
  ]
  samples.forEach(sample => save(sample as unknown as Row))
}
