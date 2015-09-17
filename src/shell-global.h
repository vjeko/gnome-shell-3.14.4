/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
#ifndef __SHELL_GLOBAL_H__
#define __SHELL_GLOBAL_H__

#include <clutter/clutter.h>
#include <glib-object.h>
#include <gdk-pixbuf/gdk-pixbuf.h>
#include <gtk/gtk.h>
#include <meta/meta-plugin.h>
#include <clutter/clutter.h>

G_BEGIN_DECLS

typedef struct _ShellGlobal      ShellGlobal;
typedef struct _ShellGlobalClass ShellGlobalClass;

#define SHELL_TYPE_GLOBAL              (shell_global_get_type ())
#define SHELL_GLOBAL(object)           (G_TYPE_CHECK_INSTANCE_CAST ((object), SHELL_TYPE_GLOBAL, ShellGlobal))
#define SHELL_GLOBAL_CLASS(klass)      (G_TYPE_CHECK_CLASS_CAST ((klass), SHELL_TYPE_GLOBAL, ShellGlobalClass))
#define SHELL_IS_GLOBAL(object)        (G_TYPE_CHECK_INSTANCE_TYPE ((object), SHELL_TYPE_GLOBAL))
#define SHELL_IS_GLOBAL_CLASS(klass)   (G_TYPE_CHECK_CLASS_TYPE ((klass), SHELL_TYPE_GLOBAL))
#define SHELL_GLOBAL_GET_CLASS(obj)    (G_TYPE_INSTANCE_GET_CLASS ((obj), SHELL_TYPE_GLOBAL, ShellGlobalClass))

struct _ShellGlobalClass
{
  GObjectClass parent_class;
};

GType shell_global_get_type (void) G_GNUC_CONST;

ShellGlobal   *shell_global_get                       (void);

ClutterStage  *shell_global_get_stage                 (ShellGlobal *global);
MetaScreen    *shell_global_get_screen                (ShellGlobal *global);
GdkScreen     *shell_global_get_gdk_screen            (ShellGlobal *global);
MetaDisplay   *shell_global_get_display               (ShellGlobal *global);
GList         *shell_global_get_window_actors         (ShellGlobal *global);
GSettings     *shell_global_get_settings              (ShellGlobal *global);
GSettings     *shell_global_get_overrides_settings    (ShellGlobal *global);
guint32        shell_global_get_current_time          (ShellGlobal *global);


/* Input/event handling */
gboolean shell_global_begin_modal            (ShellGlobal         *global,
                                              guint32             timestamp,
                                              MetaModalOptions    options);
void     shell_global_end_modal              (ShellGlobal         *global,
                                              guint32              timestamp);
void     shell_global_freeze_keyboard        (ShellGlobal         *global,
                                              guint32              timestamp);

void     shell_global_set_stage_input_region (ShellGlobal         *global,
                                              GSList              *rectangles);

void    shell_global_get_pointer             (ShellGlobal         *global,
                                              int                 *x,
                                              int                 *y,
                                              ClutterModifierType *mods);



typedef struct {
  guint glibc_uordblks;

  guint js_bytes;

  guint gjs_boxed;
  guint gjs_gobject;
  guint gjs_function;
  guint gjs_closure;

  /* 32 bit to avoid js conversion problems with 64 bit */
  guint  last_gc_seconds_ago;
} ShellMemoryInfo;


typedef struct {
  guint vp_x;
  guint vp_y;
  guint vp_width;
  guint vp_height;

  gdouble x_factor;
  gdouble y_factor;

  ClutterActor* actor;
  ClutterActor* mouse;
} ShellZoomRegion;

ShellZoomRegion regions[64];
guint region_size;

void
shell_global_quad_insert(ShellGlobal* global,
    gint x, gint y, gint width, gint height, gint value);

gint
shell_global_quad_find(ShellGlobal* global,
    gint x, gint y);

void shell_global_zoom_in(ShellGlobal* global);
void shell_global_zoom_out(ShellGlobal* global);

/* Run-at-leisure API */
void shell_global_begin_work     (ShellGlobal          *global);
void shell_global_end_work       (ShellGlobal          *global);

typedef void (*ShellLeisureFunction) (gpointer data);

void shell_global_run_at_leisure (ShellGlobal          *global,
                                  ShellLeisureFunction  func,
                                  gpointer              user_data,
                                  GDestroyNotify        notify);

void shell_global_run_at_interval (ShellGlobal* global);


void shell_global_clip (
    ShellGlobal         *global,
    gdouble* xCenter, gdouble* yCenter,
    gdouble xMouse, gdouble yMouse,
    gdouble xFactor, gdouble yFactor,
    gint width, gint height,
    gint viewPortX, gint viewPortY);

void shell_global_get_roi(
    ShellGlobal         *global,
    gdouble* xROI, gdouble* yROI,
    gdouble* widthROI, gdouble* heightROI,
    gdouble xFactor, gdouble yFactor,
    guint width, guint height,
    guint viewPortX, guint viewPortY);

void shell_global_mag_add(
    ShellGlobal         *global,
    guint vp_x, guint vp_y,
    guint cp_width, guint vp_height,
    ClutterActor* actor,
    ClutterActor* mouse);

void shell_global_mag_center(
    ShellGlobal         *global,
    gdouble* xPos, gdouble* yPos,
    gdouble xPoint, gdouble yPoint,
    gdouble xFactor, gdouble yFactor,
    guint width, guint height,
    guint viewPortX, guint viewPortY);

void shell_global_mag_center_mouse(
    ShellGlobal         *global,
    gdouble* xPos, gdouble* yPos,
    gdouble xFactor, gdouble yFactor,
    guint width, guint height,
    guint viewPortX, guint viewPortY);

void shell_global_screenToViewPort(
    ShellGlobal         *global,
    gdouble* x, gdouble* y,
    gdouble xPos, gdouble yPos,
    gdouble xFactor, gdouble yFactor,
    gint idx);

void shell_global_move(
    ShellGlobal         *global);

/* Misc utilities / Shell API */
void     shell_global_sync_pointer              (ShellGlobal  *global);

GAppLaunchContext *
         shell_global_create_app_launch_context (ShellGlobal  *global,
                                                 int           timestamp,
                                                 int           workspace);

void     shell_global_play_theme_sound          (ShellGlobal *global,
                                                 guint        id,
                                                 const char   *name,
                                                 const char   *description,
                                                 ClutterEvent *for_event);
void     shell_global_play_theme_sound_full     (ShellGlobal  *global,
                                                 guint         id,
                                                 const char   *name,
                                                 const char   *description,
                                                 ClutterEvent *for_event,
                                                 const char   *application_id,
                                                 const char   *application_name);
void     shell_global_play_sound_file           (ShellGlobal  *global,
                                                 guint         id,
                                                 const char   *file_name,
                                                 const char   *description,
                                                 ClutterEvent *for_event);
void     shell_global_play_sound_file_full      (ShellGlobal  *global,
                                                 guint         id,
                                                 const char   *file_name,
                                                 const char   *description,
                                                 ClutterEvent *for_event,
                                                 const char   *application_id,
                                                 const char   *application_name);

void     shell_global_cancel_theme_sound        (ShellGlobal  *global,
                                                 guint         id);

void     shell_global_notify_error              (ShellGlobal  *global,
                                                 const char   *msg,
                                                 const char   *details);

void     shell_global_init_xdnd                 (ShellGlobal  *global);

void     shell_global_reexec_self               (ShellGlobal  *global);

const char *     shell_global_get_session_mode  (ShellGlobal  *global);

void     shell_global_set_runtime_state         (ShellGlobal  *global,
                                                 const char   *property_name,
                                                 GVariant     *variant);
GVariant * shell_global_get_runtime_state       (ShellGlobal  *global,
                                                 const char   *property_type,
                                                 const char   *property_name);

void     shell_global_set_persistent_state      (ShellGlobal  *global,
                                                 const char   *property_name,
                                                 GVariant     *variant);
GVariant * shell_global_get_persistent_state    (ShellGlobal  *global,
                                                 const char   *property_type,
                                                 const char   *property_name);

G_END_DECLS

#endif /* __SHELL_GLOBAL_H__ */
