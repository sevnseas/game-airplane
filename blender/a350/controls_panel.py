"""Optional Blender UI. Run this text from the .blend's Text Editor."""
import bpy

class A350_OT_camera(bpy.types.Operator):
    bl_idname='a350.camera'
    bl_label='Enter aircraft viewpoint'
    camera: bpy.props.StringProperty()
    def execute(self,context):
        obj=bpy.data.objects.get(self.camera)
        if obj:
            context.scene.camera=obj
            for area in context.screen.areas:
                if area.type=='VIEW_3D':
                    area.spaces.active.region_3d.view_perspective='CAMERA'
        return {'FINISHED'}

class A350_OT_manual(bpy.types.Operator):
    bl_idname='a350.manual'
    bl_label='Use manual controls'
    def execute(self,context):
        obj=bpy.data.objects['A350 FLIGHT CONTROLS']
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:track.mute=True
            obj.animation_data.action=None
        self.report({'INFO'},'Demo action detached; controls now stay at your settings. Demo action is retained in file.')
        return {'FINISHED'}

class A350_PT_controls(bpy.types.Panel):
    bl_label='A350-1000'
    bl_idname='A350_PT_controls'
    bl_space_type='VIEW_3D'
    bl_region_type='UI'
    bl_category='A350'
    def draw(self,context):
        layout=self.layout
        obj=bpy.data.objects.get('A350 FLIGHT CONTROLS')
        if not obj:return
        layout.operator('a350.manual')
        for name in ['aileron','elevator','rudder','flaps','spoilers','gear','doors','throttle','steering','cutaway']:
            layout.prop(obj,'["'+name+'"]',text=name.replace('_',' ').title(),slider=True)
        layout.separator()
        for cam in sorted((o for o in context.scene.objects if o.type=='CAMERA'),key=lambda x:x.name):
            op=layout.operator('a350.camera',text=cam.name);op.camera=cam.name
        layout.label(text='Walk: Shift + `, then W A S D / Q E')

classes=[A350_OT_camera,A350_OT_manual,A350_PT_controls]
def register():
    for cls in classes:
        old=getattr(bpy.types,cls.__name__,None)
        if old:bpy.utils.unregister_class(old)
        bpy.utils.register_class(cls)
if __name__=='__main__':register()
